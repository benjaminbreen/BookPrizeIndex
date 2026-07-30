export function hasBlobStorageCredentials(
  environment: Record<string, string | undefined> = process.env,
) {
  return Boolean(
    environment.BLOB_STORE_ID?.trim() ||
    environment.BLOB_READ_WRITE_TOKEN?.trim(),
  );
}

export function getBlobStorageAccess(
  environment: Record<string, string | undefined> = process.env,
): "public" | "private" {
  return environment.BLOB_ACCESS?.trim().toLowerCase() === "private"
    ? "private"
    : "public";
}
