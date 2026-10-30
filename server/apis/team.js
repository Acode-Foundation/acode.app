const { Router } = require('express');

const router = Router();

let cache = null;
let cacheTime = 0;
let refreshPromise = null;
let retryAfter = 0;
let lastError = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const RETRY_DELAY = 30 * 1000;
// Include these teammates even when they are absent from GitHub's public org roster.
const ADDITIONAL_TEAM_MEMBERS = ['UnschooledGamer', 'Elitex07'];

async function fetchTeamMembers() {
  // Bound the entire refresh, including profile response bodies, to five seconds.
  const signal = AbortSignal.timeout(5000);
  const membersRes = await fetch('https://api.github.com/orgs/Acode-Foundation/public_members', { signal });
  if (!membersRes.ok) {
    throw new Error(`GitHub API error: ${membersRes.status}`);
  }
  const members = await membersRes.json();
  const memberLogins = new Set(members.map((member) => member.login.toLowerCase()));
  for (const login of ADDITIONAL_TEAM_MEMBERS) {
    if (memberLogins.has(login.toLowerCase())) continue;
    members.push({
      login,
      avatar_url: `https://github.com/${login}.png`,
      html_url: `https://github.com/${login}`,
    });
    memberLogins.add(login.toLowerCase());
  }

  const enriched = await Promise.all(
    members.map(async (member) => {
      try {
        const userRes = await fetch(`https://api.github.com/users/${member.login}`, { signal });
        if (!userRes.ok) return member;
        const profile = await userRes.json();
        return {
          login: member.login,
          avatar_url: profile.avatar_url || member.avatar_url,
          html_url: profile.html_url || member.html_url,
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

    if (Date.now() < retryAfter) throw lastError;

    if (!refreshPromise) {
      refreshPromise = fetchTeamMembers()
        .then((members) => {
          cache = members;
          cacheTime = Date.now();
          retryAfter = 0;
          lastError = null;
          return members;
        })
        .catch((error) => {
          retryAfter = Date.now() + RETRY_DELAY;
          lastError = error;
          throw error;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }
    res.json(await refreshPromise);
  } catch (error) {
    if (cache) {
      return res.json(cache);
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
