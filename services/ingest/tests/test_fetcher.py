import pytest

from qarib_ingest.config import Settings
from qarib_ingest.fetcher import (
    BlockedError,
    CircuitBreaker,
    CircuitOpen,
    DomainRateLimiter,
    FetchError,
    PoliteFetcher,
    ResponseTooLarge,
    RobotsDisallowed,
)

from .conftest import LocalServer


class FakeClock:
    def __init__(self) -> None:
        self.t = 100.0
        self.sleeps: list[float] = []

    def now(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.t += s


def make(server: LocalServer, **overrides: object) -> tuple[PoliteFetcher, FakeClock, list[str]]:
    clock = FakeClock()
    tripped: list[str] = []
    settings = Settings(user_agent="QaribBot/1.0 (+https://test.example/bot; legal@test.example)")
    if overrides:
        settings = Settings(**{**settings.__dict__, **overrides})  # type: ignore[arg-type,unused-ignore]
    f = PoliteFetcher(
        settings,
        limiter=DomainRateLimiter(settings.min_interval_s, 0.0, clock.now, clock.sleep),
        breaker=CircuitBreaker(3, tripped.append),
        clock=clock.now,
    )
    return f, clock, tripped


# ---- rate limiter -------------------------------------------------------------------------------
def test_rate_limiter_spaces_requests_per_host_and_globally() -> None:
    clock = FakeClock()
    lim = DomainRateLimiter(2.0, 0.25, clock.now, clock.sleep)
    lim.wait("a.example")  # immediate
    lim.wait("a.example")  # must wait the full 2 s
    lim.wait("b.example")  # other host: only the global 0.25 s spacing applies
    assert clock.sleeps[0] == pytest.approx(2.0)
    assert len(clock.sleeps) >= 1
    assert clock.t - 100.0 >= 2.0


def test_rate_limiter_no_wait_after_enough_time() -> None:
    clock = FakeClock()
    lim = DomainRateLimiter(2.0, 0.0, clock.now, clock.sleep)
    lim.wait("a.example")
    clock.t += 5
    lim.wait("a.example")
    assert clock.sleeps == []


# ---- robots.txt + user agent ------------------------------------------------------------------
def test_sends_identifying_user_agent_and_respects_robots_allow(server: LocalServer) -> None:
    server.add("/robots.txt", "User-agent: *\nDisallow: /private/\n")
    server.add("/prices", "ok")
    f, _, _ = make(server)
    resp = f.get(server.base + "/prices")
    assert resp.content == b"ok"
    ua = dict(server.requests[-1][1])["User-Agent"]
    assert "QaribBot" in ua and "legal@test.example" in ua
    assert any(p == "/robots.txt" for p, _ in server.requests)


def test_robots_disallow_blocks_without_fetching_the_page(server: LocalServer) -> None:
    server.add("/robots.txt", "User-agent: *\nDisallow: /private/\n")
    server.add("/private/x", "secret")
    f, _, _ = make(server)
    with pytest.raises(RobotsDisallowed):
        f.get(server.base + "/private/x")
    assert server.hits("/private/x") == 0


def test_robots_rules_for_our_own_product_token(server: LocalServer) -> None:
    server.add("/robots.txt", "User-agent: QaribBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n")
    server.add("/p", "x")
    f, _, _ = make(server)
    with pytest.raises(RobotsDisallowed):
        f.get(server.base + "/p")


@pytest.mark.parametrize("status", [401, 403, 500, 503])
def test_unreadable_robots_fails_closed(server: LocalServer, status: int) -> None:
    server.add("/robots.txt", "nope", status=status)
    server.add("/p", "x")
    f, _, _ = make(server)
    with pytest.raises(RobotsDisallowed):
        f.get(server.base + "/p")
    assert server.hits("/p") == 0


def test_missing_robots_means_allowed(server: LocalServer) -> None:
    server.add("/p", "x")  # /robots.txt -> 404
    f, _, _ = make(server)
    assert f.get(server.base + "/p").content == b"x"


def test_robots_cached_between_requests(server: LocalServer) -> None:
    server.add("/robots.txt", "User-agent: *\nAllow: /\n")
    server.add("/a", "a")
    server.add("/b", "b")
    f, _, _ = make(server)
    f.get(server.base + "/a")
    f.get(server.base + "/b")
    assert server.hits("/robots.txt") == 1


def test_requests_are_rate_limited_per_domain(server: LocalServer) -> None:
    server.add("/a", "a")
    server.add("/b", "b")
    f, clock, _ = make(server, min_interval_s=2.0)
    f.get(server.base + "/a")  # robots (t0), page (t0+2)
    f.get(server.base + "/b")  # +2
    assert clock.t - 100.0 >= 4.0, "three requests to one host must be >= 2 s apart each"


# ---- never bypass blocks ---------------------------------------------------------------------
def test_403_trips_breaker_after_three_and_then_refuses_everything(server: LocalServer) -> None:
    server.add("/blocked", "go away", status=403)
    server.add("/ok", "fine")
    f, _, tripped = make(server)
    for _ in range(3):
        with pytest.raises(BlockedError):
            f.get(server.base + "/blocked")
    assert len(tripped) == 1 and "403" in tripped[0]
    before = len(server.requests)
    with pytest.raises(CircuitOpen):
        f.get(server.base + "/ok")
    assert len(server.requests) == before, "no further network traffic once tripped"


def test_429_and_captcha_pages_count_as_blocks(server: LocalServer) -> None:
    server.add("/rate", "slow down", status=429)
    server.add(
        "/cap",
        "<html><title>Attention Required!</title>Please complete the CAPTCHA</html>",
        200,
        Content_Type="text/html",
    )
    f, _, tripped = make(server)
    with pytest.raises(BlockedError):
        f.get(server.base + "/rate")
    with pytest.raises(BlockedError):
        f.get(server.base + "/cap")
    assert f.breaker.consecutive == 2 and not tripped


def test_success_resets_the_block_counter(server: LocalServer) -> None:
    server.add("/blocked", "x", status=403)
    server.add("/ok", "fine")
    f, _, tripped = make(server)
    for _ in range(2):
        with pytest.raises(BlockedError):
            f.get(server.base + "/blocked")
    f.get(server.base + "/ok")
    assert f.breaker.consecutive == 0
    for _ in range(2):
        with pytest.raises(BlockedError):
            f.get(server.base + "/blocked")
    assert not tripped


def test_other_errors_do_not_count_as_blocks(server: LocalServer) -> None:
    server.add("/boom", "err", status=500)
    f, _, _ = make(server)
    for _ in range(5):
        with pytest.raises(FetchError):
            f.get(server.base + "/boom")
    assert f.breaker.consecutive == 0 and not f.breaker.tripped


# ---- redirects + size limits ------------------------------------------------------------------
def test_redirect_target_is_also_checked_against_robots(server: LocalServer) -> None:
    server.add("/robots.txt", "User-agent: *\nDisallow: /hidden\n")
    server.add("/go", "", status=302, Location="/hidden")
    server.add("/hidden", "secret")
    f, _, _ = make(server)
    with pytest.raises(RobotsDisallowed):
        f.get(server.base + "/go")
    assert server.hits("/hidden") == 0


def test_redirect_followed_when_allowed_and_loop_is_bounded(server: LocalServer) -> None:
    server.add("/a", "", status=302, Location="/b")
    server.add("/b", "final")
    server.add("/loop", "", status=302, Location="/loop")
    f, _, _ = make(server)
    assert f.get(server.base + "/a").content == b"final"
    with pytest.raises(FetchError, match="redirects"):
        f.get(server.base + "/loop")


def test_response_size_limit(server: LocalServer) -> None:
    server.add("/big", b"x" * 5000)
    f, _, _ = make(server, max_response_bytes=1000)
    with pytest.raises(ResponseTooLarge):
        f.get(server.base + "/big")
