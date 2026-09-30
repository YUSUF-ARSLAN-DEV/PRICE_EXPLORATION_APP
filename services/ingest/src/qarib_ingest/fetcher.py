"""Polite HTTP fetching (plan 3.2; data-collection policy P4/P5).

Rules enforced here, in code:
  * identify ourselves with a contact User-Agent
  * obey robots.txt (RFC 9309 semantics; fail closed when it cannot be fetched)
  * per-domain and global rate limits
  * never bypass blocks: 403/429/CAPTCHA are counted by a circuit breaker which disables the
    source after N consecutive hits - there is NO retry-with-evasion path
"""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

from .config import Settings

log = logging.getLogger(__name__)

PRODUCT_TOKEN = "QaribBot"  # noqa: S105 - robots.txt product token, not a credential
CAPTCHA_MARKERS = (
    "captcha",
    "are you a robot",
    "verify you are human",
    "cf-chl",
    "attention required",
)


class FetchError(Exception):
    """Any failure to fetch a URL."""


class RobotsDisallowed(FetchError):
    """robots.txt forbids this URL for our user agent (or could not be read)."""


class BlockedError(FetchError):
    """403/429/CAPTCHA: the site does not want us. Counted by the circuit breaker."""


class CircuitOpen(FetchError):
    """The breaker has tripped for this source; no further requests are allowed."""


class ResponseTooLarge(FetchError):
    pass


@dataclass(frozen=True)
class Response:
    url: str
    status: int
    content: bytes
    content_type: str


class DomainRateLimiter:
    """At most one request per `min_interval` per host, and one per `global_interval` overall."""

    def __init__(
        self,
        min_interval: float = 2.0,
        global_interval: float = 0.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.min_interval = min_interval
        self.global_interval = global_interval
        self._clock = clock
        self._sleep = sleep
        self._next_host: dict[str, float] = {}
        self._next_global = 0.0

    def wait(self, host: str) -> None:
        now = self._clock()
        start = max(now, self._next_host.get(host, 0.0), self._next_global)
        if start > now:
            self._sleep(start - now)
        self._next_host[host] = start + self.min_interval
        self._next_global = start + self.global_interval


class CircuitBreaker:
    def __init__(self, threshold: int = 3, on_trip: Callable[[str], None] | None = None) -> None:
        self.threshold = threshold
        self.on_trip = on_trip
        self.consecutive = 0
        self.tripped = False

    def check(self) -> None:
        if self.tripped:
            raise CircuitOpen("circuit breaker is open: source has been disabled")

    def record_success(self) -> None:
        self.consecutive = 0

    def record_block(self, reason: str) -> None:
        self.consecutive += 1
        if self.consecutive >= self.threshold and not self.tripped:
            self.tripped = True
            log.error("circuit breaker tripped after %d blocks: %s", self.consecutive, reason)
            if self.on_trip:
                self.on_trip(reason)


@dataclass
class _RobotsEntry:
    parser: RobotFileParser | None  # None => disallow everything
    fetched_at: float = 0.0


@dataclass
class PoliteFetcher:
    settings: Settings
    client: httpx.Client | None = None
    limiter: DomainRateLimiter | None = None
    breaker: CircuitBreaker = field(default_factory=CircuitBreaker)
    clock: Callable[[], float] = time.monotonic
    _robots: dict[str, _RobotsEntry] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.limiter is None:
            self.limiter = DomainRateLimiter(
                self.settings.min_interval_s, self.settings.global_interval_s
            )
        if self.client is None:
            self.client = httpx.Client(timeout=self.settings.request_timeout_s)

    # ---- robots.txt -------------------------------------------------------------------------
    def _load_robots(self, scheme: str, host: str) -> _RobotsEntry:
        assert self.limiter is not None and self.client is not None
        url = f"{scheme}://{host}/robots.txt"
        self.limiter.wait(host)
        try:
            resp = self.client.get(
                url,
                headers={"User-Agent": self.settings.user_agent},
                follow_redirects=False,
                timeout=self.settings.request_timeout_s,
            )
        except httpx.HTTPError as exc:
            log.warning("robots.txt unreachable for %s (%s): treating as disallow-all", host, exc)
            return _RobotsEntry(None, self.clock())
        parser = RobotFileParser()
        if resp.status_code == 200:
            parser.parse(resp.text.splitlines())
            return _RobotsEntry(parser, self.clock())
        if resp.status_code in (401, 403) or resp.status_code >= 500:
            # Conservative: a blocked or failing robots.txt is not permission.
            log.warning(
                "robots.txt for %s returned %s: treating as disallow-all", host, resp.status_code
            )
            return _RobotsEntry(None, self.clock())
        # 404 / 410 / other 4xx: no robots file => allowed (RFC 9309 section 2.3.1.3)
        parser.parse([])
        return _RobotsEntry(parser, self.clock())

    def allowed(self, url: str) -> bool:
        parts = urlparse(url)
        host = parts.netloc.lower()
        entry = self._robots.get(host)
        if entry is None or self.clock() - entry.fetched_at > self.settings.robots_ttl_s:
            entry = self._load_robots(parts.scheme, host)
            self._robots[host] = entry
        if entry.parser is None:
            return False
        return entry.parser.can_fetch(PRODUCT_TOKEN, url)

    # ---- GET --------------------------------------------------------------------------------
    def get(self, url: str, headers: dict[str, str] | None = None) -> Response:
        assert self.limiter is not None and self.client is not None
        self.breaker.check()
        current = url
        for _ in range(self.settings.max_redirects + 1):
            if not self.allowed(current):
                raise RobotsDisallowed(f"robots.txt disallows {current}")
            host = urlparse(current).netloc.lower()
            self.limiter.wait(host)
            req_headers = {"User-Agent": self.settings.user_agent, **(headers or {})}
            try:
                with self.client.stream(
                    "GET",
                    current,
                    headers=req_headers,
                    follow_redirects=False,
                    timeout=self.settings.request_timeout_s,
                ) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308) and "location" in resp.headers:
                        current = urljoin(current, resp.headers["location"])
                        continue
                    body = self._read_limited(resp)
                    ctype = resp.headers.get("content-type", "")
                    status = resp.status_code
            except httpx.HTTPError as exc:
                raise FetchError(f"request to {current} failed: {exc}") from exc

            if status in (403, 429):
                self.breaker.record_block(f"HTTP {status} from {host}")
                raise BlockedError(f"HTTP {status} from {current}")
            if status == 200 and "html" in ctype.lower() and self._looks_like_captcha(body):
                self.breaker.record_block(f"CAPTCHA/challenge page from {host}")
                raise BlockedError(f"challenge page from {current}")
            if status >= 400:
                raise FetchError(f"HTTP {status} from {current}")
            self.breaker.record_success()
            return Response(url=current, status=status, content=body, content_type=ctype)
        raise FetchError(f"too many redirects starting at {url}")

    def _read_limited(self, resp: httpx.Response) -> bytes:
        chunks: list[bytes] = []
        total = 0
        for chunk in resp.iter_bytes():
            total += len(chunk)
            if total > self.settings.max_response_bytes:
                raise ResponseTooLarge(
                    f"response larger than {self.settings.max_response_bytes} bytes"
                )
            chunks.append(chunk)
        return b"".join(chunks)

    @staticmethod
    def _looks_like_captcha(body: bytes) -> bool:
        head = body[:20000].decode("utf-8", errors="ignore").lower()
        return any(marker in head for marker in CAPTCHA_MARKERS)
