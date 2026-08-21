const GOATCOUNTER_COUNT_API_URL = "https://stats.mysite.example/api/v0/count";
const FEED_FETCH_EVENT_PATH = "feed-fetch";

export async function onRequest(context) {
  context.passThroughOnException();

  const response = await context.env.ASSETS.fetch(context.request);

  if (context.request.method === "GET" && response.ok) {
    context.waitUntil(
      countFeedFetch(context).catch((error) => {
        console.error("Failed to track feed fetch:", error);
      })
    );
  }

  return response;
}

async function countFeedFetch({ env }) {
  const token = env.GOATCOUNTER_API_TOKEN;
  if (!token) return;

  const response = await fetch(env.GOATCOUNTER_COUNT_API_URL || GOATCOUNTER_COUNT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      no_sessions: true,
      hits: [
        {
          path: FEED_FETCH_EVENT_PATH,
          title: "Feed: Abruf",
          event: true
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`GoatCounter count API returned ${response.status}`);
  }
}
