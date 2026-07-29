"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

export function PrivacyFriendlyAnalytics() {
  return (
    <Analytics
      beforeSend={(event: BeforeSendEvent) => {
        const url = new URL(event.url);
        url.search = "";
        url.hash = "";

        return {
          ...event,
          url: url.toString(),
        };
      }}
    />
  );
}
