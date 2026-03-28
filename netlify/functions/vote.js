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

  // Increment
  if (vote === "like") {
    await fetch(`${url}/incr/${keyLikes}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    await fetch(`${url}/incr/${keyDislikes}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

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
      likes: Number(likesData.result || 0),
      dislikes: Number(dislikesData.result || 0),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
};