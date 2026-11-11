const fs = require('node:fs/promises');
const path = require('node:path');
const { markdownToTxt } = require('markdown-to-txt');
const { hashString, verifiedCategory } = require('../../shared/faqs');

function storedCategories(data) {
  const groups = Array.isArray(data) ? [{ id: 'general', name: 'General', faqs: data }] : data?.categories;
  return (Array.isArray(groups) ? groups : []).filter((group) => Array.isArray(group?.faqs));
}

function buildFaqCatalog(data) {
  const categories = storedCategories(data).map((group) => ({
    ...group,
    faqs: group.faqs.filter((faq) => typeof faq?.q === 'string' && faq.q.trim() && typeof faq.a === 'string' && faq.a.trim()),
  }));
  const byId = new Map();
  for (const category of [...categories, verifiedCategory()]) {
    for (const faq of category.faqs) {
      const id = hashString(faq.q);
      if (byId.has(id)) {
        console.warn(`Duplicate FAQ URL /faqs/${id}; keeping the first question.`);
        continue;
      }
      byId.set(id, { faq, category, text: markdownToTxt(faq.a) });
    }
  }
  return { categories, byId };
}

function createFaqReader(file) {
  let cache;
  async function read() {
    // Detect admin edits (including writes from other workers) and file replacements.
    const { ino, ctimeNs, size } = await fs.stat(file, { bigint: true });
    const revision = `${ino}:${ctimeNs}:${size}`;
    if (cache?.revision !== revision) {
      const result = fs
        .readFile(file, 'utf8')
        .then((json) => buildFaqCatalog(JSON.parse(json)))
        .catch((error) => {
          if (cache?.result === result) cache = null;
          throw error;
        });
      cache = { revision, result };
    }
    return cache.result;
  }
  read.invalidate = () => {
    cache = null;
  };
  return read;
}

const readFaqCatalog = createFaqReader(path.resolve(__dirname, '../../data/faqs.json'));
const builtin = buildFaqCatalog([]).byId;

// Check proposed changes against the same file snapshot that the admin handler will save.
function faqUrlInUse(data, question, previousFaq) {
  const id = hashString(question);
  return (
    builtin.has(id) ||
    storedCategories(data).some((category) =>
      category.faqs.some((faq) => faq !== previousFaq && typeof faq?.q === 'string' && hashString(faq.q) === id),
    )
  );
}

async function findFaq(id, read = readFaqCatalog) {
  try {
    return (await read()).byId.get(id);
  } catch (error) {
    if (builtin.has(id)) return builtin.get(id);
    throw error;
  }
}

module.exports = { faqUrlInUse, builtin, storedCategories, buildFaqCatalog, createFaqReader, readFaqCatalog, findFaq };
