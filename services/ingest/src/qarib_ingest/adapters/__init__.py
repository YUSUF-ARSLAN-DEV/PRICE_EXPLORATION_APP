"""Source adapters. Every adapter implements fetch() + parse() (plan 3.1)."""

from .base import ParseResult, RawArtefact, SourceAdapter

__all__ = ["ParseResult", "RawArtefact", "SourceAdapter"]
