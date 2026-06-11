const { Router } = require('express');

const router = Router();

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchTeamMembers() {
  const membersRes = await fetch('https://api.github.com/orgs/Acode-Foundation/public_members');
  if (!membersRes.ok) {
    throw new Error(`GitHub API error: ${membersRes.status}`);
  }
  const members = await membersRes.json();

  const enriched = await Promise.all(
    members.map(async (member) => {
      try {
        const userRes = await fetch(`https://api.github.com/users/${member.login}`);
        if (!userRes.ok) return member;
        const profile = await userRes.json();
        return {
          login: member.login,
          avatar_url: member.avatar_url,
          html_url: member.html_url,
          name: profile.name || null,
          bio: profile.bio || null,
          blog: profile.blog || null,
          location: profile.location || null,
          twitter_username: profile.twitter_username || null,
          followers: profile.followers || 0,
        };
      } catch {
        return member;
      }
    }),
  );

  return enriched;
}

router.get('/', async (_req, res) => {
  try {
    if (cache && Date.now() - cacheTime < CACHE_TTL) {
      return res.json(cache);
    }

    const members = await fetchTeamMembers();
    cache = members;
    cacheTime = Date.now();
    res.json(members);
  } catch (error) {
    if (cache) {
      return res.json(cache);
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
