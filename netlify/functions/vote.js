export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { post_slug, vote } = await req.json();

  if (!post_slug || !vote) {
    return new Response("Bad Request", { status: 400 });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  const keyLikes = `likes:${post_slug}`;
  const keyDislikes = `dislikes:${post_slug}`;

if (!url || !token) {
  return new Response(
    JSON.stringify({
      error: "Missing env vars",
      url,
      tokenExists: !!token,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

const command = vote === "like"
  ? ["INCR", keyLikes]
  : ["INCR", keyDislikes];

const incrRes = await fetch(`${url}/pipeline`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify([command]),
});

const incrData = await incrRes.json();

  // Get counts
  const [likesRes, dislikesRes] = await Promise.all([
    fetch(`${url}/get/${keyLikes}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(`${url}/get/${keyDislikes}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  const likesData = await likesRes.json();
  const dislikesData = await dislikesRes.json();

  return new Response(
  JSON.stringify({
    incrData,
  }),
  { headers: { "Content-Type": "application/json" } }
);
};