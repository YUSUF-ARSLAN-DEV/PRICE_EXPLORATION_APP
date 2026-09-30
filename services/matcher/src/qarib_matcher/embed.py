"""Optional embedding + LLM tiers (plan 4.1 steps 3-4). Both are OFF unless configured."""

import hashlib
import json
import math
from typing import Any, Literal, Protocol

DIM = 384


class Embedder(Protocol):
    def embed(self, text: str) -> list[float]: ...


class NgramHashEmbedder:
    """Dependency-free baseline: hashed character 3-grams. Lexical, NOT semantic - it helps with
    spelling variants but cannot bridge Arabic<->English. Use a multilingual model in production
    (e.g. multilingual-e5-small, 384-dim) via SentenceTransformerEmbedder."""

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * DIM
        padded = f"  {text.lower()}  "
        for i in range(len(padded) - 2):
            h = int.from_bytes(
                hashlib.blake2b(padded[i : i + 3].encode(), digest_size=4).digest(), "big"
            )
            vec[h % DIM] += 1.0 if (h >> 31) & 1 else -1.0
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]


class SentenceTransformerEmbedder:
    """Self-hosted multilingual model (no data leaves our infrastructure). Needs the optional
    `sentence-transformers` package and a downloaded model; NOT exercised by the test-suite."""

    def __init__(self, model_name: str = "intfloat/multilingual-e5-small") -> None:
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name)

    def embed(self, text: str) -> list[float]:
        return [float(x) for x in self._model.encode("query: " + text, normalize_embeddings=True)]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def to_pgvector(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


Verdict = Literal["same", "different", "unsure"]


class Adjudicator(Protocol):
    def adjudicate(self, listing: str, product: str) -> Verdict: ...


class AnthropicAdjudicator:
    """LLM tie-breaker for borderline scores (0.80-0.93), behind a feature flag.

    Privacy: ONLY the two product-name strings are sent - never user data. The Anthropic API is a
    non-Qatar processor: it must be listed in docs/legal/subprocessors.md and approved by counsel
    before this is enabled in production. NOT exercised against the live API by the test-suite.
    """

    PROMPT = (
        "You compare two grocery product listings from different Qatari retailers. They may be in "
        'English or Arabic. Answer with JSON only: {{"verdict": "same"|"different"|"unsure"}}. '
        "'same' means the identical item (same brand, variant, flavour, size and pack count).\n"
        "A: {a}\nB: {b}"
    )

    def __init__(self, client: Any | None = None, model: str = "claude-haiku-4-5-20251001") -> None:
        if client is None:
            import anthropic

            client = anthropic.Anthropic()
        self._client = client
        self._model = model

    def adjudicate(self, listing: str, product: str) -> Verdict:
        resp = self._client.messages.create(
            model=self._model,
            max_tokens=40,
            messages=[
                {"role": "user", "content": self.PROMPT.format(a=listing[:300], b=product[:300])}
            ],
        )
        try:
            text = resp.content[0].text
            verdict = json.loads(text[text.index("{") : text.rindex("}") + 1])["verdict"]
        except (ValueError, KeyError, IndexError, AttributeError, TypeError):
            return "unsure"
        return verdict if verdict in ("same", "different") else "unsure"
