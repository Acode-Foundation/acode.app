const FALLBACK = {
  crystal: { label: 'Crystal', price: 100, description: 'Get your name listed on our sponsors page' },
  bronze: { label: 'Bronze', price: 200, description: 'Get your name listed on our sponsors page as a supporter' },
  silver: { label: 'Silver', price: 500, description: 'Get your name and website link featured on the sponsors page' },
  gold: { label: 'Gold', price: 1000, description: 'Your logo, name, and website link featured on the sponsors page' },
  platinum: { label: 'Platinum', price: 2000, description: 'Premium placement with logo, name, website link, and tagline' },
  titanium: { label: 'Titanium', price: 5000, description: 'Premium placement, large logo, website link, and tagline' },
};

const TIER_ORDER = ['titanium', 'platinum', 'gold', 'silver', 'bronze', 'crystal'];

export { FALLBACK, TIER_ORDER };

export default async function getSponsorTiers() {
  try {
    const res = await fetch('/api/razorpay/sponsor-prices');
    const data = await res.json();
    return { tiers: data.tiers, currency: data.currency, symbol: data.symbol };
  } catch {
    return { tiers: FALLBACK, currency: 'INR', symbol: '₹' };
  }
}
