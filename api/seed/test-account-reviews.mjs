// Ten DEMONSTRATION reviews for the closed-test account mlkdesignweb@gmail.com's creator profile (9 × 5, 1 × 4 =
// 4.9), each from a different existing demo business (one review per author account). They show the Reviews UI with
// data; they are not real collaborations and must not be presented as such in a public product. Idempotent: fixed
// ids + INSERT OR IGNORE; touches no other profile's reviews. Usage: node seed/test-account-reviews.mjs > /tmp/x.sql
const recipient = `(SELECT p.id FROM profiles p JOIN users u ON u.id = p.owner_user_id
  WHERE u.email = 'mlkdesignweb@gmail.com' AND u.is_demo = 0 AND p.type = 'creator' LIMIT 1)`;
const reviews = [
  ['bz_b01', 5, 'Clear communication from brief to delivery — the serum clips looked natural and on-brand.'],
  ['bz_b02', 5, 'Great field footage of our backpack, delivered a day early and ready to post.'],
  ['bz_b04', 5, 'Beautiful pool and spa content; our guests keep asking about the reel.'],
  ['bz_b05', 5, 'Captured the street-food vibe perfectly. Easy to work with, fast edits.'],
  ['bz_b06', 4, 'Solid unboxing videos. One revision round on the hook, then all good.'],
  ['bz_b07', 5, 'Thoughtful try-on content with great light — exactly the capsule look we wanted.'],
  ['bz_b08', 5, 'Sunrise shots at the villa were stunning. Professional and punctual.'],
  ['bz_b09', 5, 'High-energy training reels that performed above our usual posts.'],
  ['bz_b10', 5, 'Warm, atmospheric tasting-room reel. Would book again for the harvest.'],
  ['bz_b11', 5, 'Lovely styling of a small living room — clean cuts and calm pacing.'],
];
const now = Date.UTC(2026, 10, 9);
const q = (s) => `'${s.replace(/'/g, "''")}'`;
console.log(reviews.map(([author, score, text], i) => `INSERT OR IGNORE INTO reviews (id, author_profile_id, author_user_id, recipient_profile_id, quality, speed, contact, comment, status, created_at)
  SELECT 'rev_testacct_${String(i + 1).padStart(2, '0')}', p.id, p.owner_user_id, ${recipient}, ${score}, ${score}, ${score}, ${q(text)}, 'published', ${now - i * 3 * 86_400_000}
  FROM profiles p WHERE p.id = '${author}' AND p.is_demo = 1 AND ${recipient} IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.author_user_id = p.owner_user_id AND r.recipient_profile_id = ${recipient} AND r.status = 'published');`).join('\n'));
