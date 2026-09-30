"""Immutable raw-artefact storage (plan 3.1). Local directory for dev, Azure Blob in cloud.

Artefacts are content-addressed (sha256) so storing the same bytes twice never overwrites anything.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class StoredArtefact:
    uri: str
    sha256: str
    size_bytes: int


class ArtifactStore(Protocol):
    def put(self, source_id: str, batch_id: str, name: str, content: bytes) -> StoredArtefact: ...

    def delete(self, uri: str) -> None: ...

    def exists(self, uri: str) -> bool: ...


def _key(source_id: str, batch_id: str, name: str, sha: str) -> str:
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)[:80] or "artefact"
    return f"{source_id}/{batch_id}/{sha[:16]}-{safe}"


class LocalArtifactStore:
    scheme = "file"

    def __init__(self, root: Path) -> None:
        self.root = root

    def put(self, source_id: str, batch_id: str, name: str, content: bytes) -> StoredArtefact:
        sha = hashlib.sha256(content).hexdigest()
        path = self.root / _key(source_id, batch_id, name, sha)
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():  # immutable: never overwrite
            path.write_bytes(content)
        return StoredArtefact(uri=path.resolve().as_uri(), sha256=sha, size_bytes=len(content))

    def _path(self, uri: str) -> Path:
        from urllib.parse import unquote, urlparse
        from urllib.request import url2pathname

        return Path(url2pathname(unquote(urlparse(uri).path)))

    def delete(self, uri: str) -> None:
        self._path(uri).unlink(missing_ok=True)

    def exists(self, uri: str) -> bool:
        return self._path(uri).exists()


class AzureBlobArtifactStore:
    """Azure Blob (or the Azurite emulator). Requires the `azure` extra."""

    scheme = "azblob"

    def __init__(
        self, connection_string: str | None, container: str, account_url: str | None = None
    ) -> None:
        from azure.core.exceptions import ResourceExistsError
        from azure.storage.blob import BlobServiceClient

        if account_url:
            from azure.identity import DefaultAzureCredential

            self._service = BlobServiceClient(account_url, credential=DefaultAzureCredential())
        elif connection_string:
            self._service = BlobServiceClient.from_connection_string(connection_string)
        else:
            raise ValueError("give a connection string or an account URL")
        self._container = self._service.get_container_client(container)
        try:
            self._container.create_container()
        except ResourceExistsError:
            pass
        self._name = container

    def put(self, source_id: str, batch_id: str, name: str, content: bytes) -> StoredArtefact:
        from azure.core.exceptions import ResourceExistsError

        sha = hashlib.sha256(content).hexdigest()
        key = _key(source_id, batch_id, name, sha)
        try:
            self._container.upload_blob(key, content, overwrite=False)
        except ResourceExistsError:
            pass  # immutable: identical key means identical content
        return StoredArtefact(
            uri=f"azblob://{self._name}/{key}", sha256=sha, size_bytes=len(content)
        )

    def _key_of(self, uri: str) -> str:
        prefix = f"azblob://{self._name}/"
        if not uri.startswith(prefix):
            raise ValueError(f"not a blob in container {self._name}: {uri}")
        return uri[len(prefix) :]

    def delete(self, uri: str) -> None:
        from azure.core.exceptions import ResourceNotFoundError

        try:
            self._container.delete_blob(self._key_of(uri))
        except ResourceNotFoundError:
            pass

    def exists(self, uri: str) -> bool:
        return bool(self._container.get_blob_client(self._key_of(uri)).exists())


def make_store(
    azure_connection_string: str | None,
    azure_container: str,
    local_dir: Path,
    azure_account_url: str | None = None,
) -> ArtifactStore:
    if azure_account_url or azure_connection_string:
        return AzureBlobArtifactStore(azure_connection_string, azure_container, azure_account_url)
    return LocalArtifactStore(local_dir)
