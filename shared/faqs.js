const { CHECKS, SIGNALS, WEIGHTS } = require('./verification');
const { normalizeMetadataText, truncateMetadataText } = require('./metadataText');

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  return Math.abs(hash).toString(36);
}

/**
 * Built from the same rules the server scores with, so the explanation can't
 * drift from what actually earns the badge. Not editable from the admin form.
 */
function verifiedCategory() {
  const points = Object.entries(SIGNALS)
    .map(([key, { label, hint }]) => `- **${label}, up to ${WEIGHTS[key]} points.** ${hint}`)
    .join('\n');
  const checklist = Object.values(CHECKS)
    .map((check) => `- ${check}`)
    .join('\n');
  return {
    id: 'verified-developers',
    name: 'Verified developers',
    description: 'What the blue tick means and how to earn it.',
    builtin: true,
    faqs: [
      {
        q: 'What does the blue tick next to a developer mean?',
        a: 'It marks a plugin developer with a track record: plugins people actually use and rate well, kept up to date, and no security problems. Verified developers also rank a little higher in plugin search.',
      },
      {
        q: 'How do I get the verified badge?',
        a: `There's nothing to apply for. We regularly review the highest-ranked developers who meet all of these:\n\n${checklist}\n\nMeeting them makes you eligible, not automatically verified. Every badge is a human decision.`,
      },
      {
        q: 'How is my developer score calculated?',
        a: `Your score is out of 100 and is used to rank developers for review:\n\n${points}\n\nSecurity strikes take points away: an upload blocked by the security scanner or an update rejected in review costs 15 points for a year, and each rejected plugin costs 3.`,
      },
      {
        q: 'Will buying downloads or reviews help?',
        a: "No. Downloads are counted once per device and weighed by how many different users they come from, and votes from throwaway accounts don't count toward your rating. Inflated numbers are easy to spot, and they can cost you the badge for good. The fastest route is a plugin people recommend and replying to their reviews.",
      },
      {
        q: 'Can I lose the badge?',
        a: "Yes. We may remove it after a security issue, a long stretch without updates on plugins people depend on, or any attempt to game downloads or reviews. If you think we got it wrong, [contact us](/contact) and we'll take another look.",
      },
    ],
  };
}

function faqMetadata(faq) {
  return { title: `${faq.q} - Acode FAQ`, description: truncateMetadataText(normalizeMetadataText(faq.a)) };
}

module.exports = { hashString, verifiedCategory, faqMetadata };
