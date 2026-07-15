const AMAZON_ASSOCIATE_TAG = "ro067-20";

export function withAmazonAssociateTag(href: string) {
  try {
    const url = new URL(href);
    if (url.hostname !== "amazon.com" && !url.hostname.endsWith(".amazon.com")) return href;
    url.searchParams.set("tag", AMAZON_ASSOCIATE_TAG);
    return url.toString();
  } catch {
    return href;
  }
}
