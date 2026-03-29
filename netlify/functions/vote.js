export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { post_slug, vote } = await req.json();

    if (!post_slug || !vote) {
      return new Response("Bad Request", { status: 400 });
    }

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    const keyLikes = `likes:${post_slug}`;
    const keyDislikes = `dislikes:${post_slug}`;

    // Increment vote
    const command =
      vote === "like"
        ? ["INCR", keyLikes]
        : ["INCR", keyDislikes];

    await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([command]),
    });

    // Get updated counts
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
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    );
  }
};