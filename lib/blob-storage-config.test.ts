import assert from "node:assert/strict";
import test from "node:test";
import { hasBlobStorageCredentials } from "@/lib/blob-storage-config";

test("modern OIDC Blob connections are recognized by store id", () => {
  assert.equal(hasBlobStorageCredentials({ BLOB_STORE_ID: "store_test" }), true);
});

test("legacy read-write token Blob connections remain supported", () => {
  assert.equal(hasBlobStorageCredentials({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test" }), true);
});

test("Blob storage is unconfigured without a store id or legacy token", () => {
  assert.equal(hasBlobStorageCredentials({}), false);
  assert.equal(hasBlobStorageCredentials({ BLOB_STORE_ID: "  " }), false);
});
