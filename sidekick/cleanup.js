/**
 * SideKick — Firebase Cloud Functions
 * File: functions/index.js
 *
 * Contains two functions:
 *   1. cleanupExpiredRooms — runs nightly, deletes rooms idle for 24+ hours
 *   2. stripeWebhook        — handles Stripe purchase webhook (wire up later)
 *
 * DEPLOY INSTRUCTIONS:
 *   1. In your project root: firebase init functions
 *      - Choose JavaScript, say NO to ESLint, say YES to installing deps
 *   2. Copy this file to functions/index.js (replace the default)
 *   3. cd functions && npm install stripe
 *   4. Set your Stripe webhook secret:
 *      firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 *      (paste the secret from Stripe Dashboard → Webhooks → your endpoint)
 *   5. firebase deploy --only functions
 */

const { onSchedule }  = require('firebase-functions/v2/scheduler');
const { onRequest }   = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase }   = require('firebase-admin/database');
const { defineSecret }  = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

initializeApp();

const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

// ── 1. NIGHTLY ROOM CLEANUP ───────────────────────────────────────────────────
// Runs every night at 3:00 AM UTC.
// Deletes any room where lastActivity is older than 24 hours.
// savedGames are stored separately and are NEVER touched by this function.

const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

exports.cleanupExpiredRooms = onSchedule('every 24 hours', async () => {
  const db       = getDatabase();
  const roomsRef = db.ref('rooms');
  const cutoff   = Date.now() - ROOM_TTL_MS;

  try {
    const snapshot = await roomsRef.once('value');
    if (!snapshot.exists()) {
      logger.info('No rooms found — nothing to clean up.');
      return;
    }

    const rooms = snapshot.val();
    const deletions = [];
    let count = 0;

    Object.entries(rooms).forEach(([code, room]) => {
      // Use lastActivity if available, fall back to createdAt, fall back to 0
      const lastActive = room.lastActivity || room.createdAt || 0;
      if (lastActive < cutoff) {
        deletions.push(db.ref(`rooms/${code}`).remove());
        count++;
        logger.info(`Deleting expired room: ${code} (idle since ${new Date(lastActive).toISOString()})`);
      }
    });

    if (deletions.length > 0) {
      await Promise.all(deletions);
      logger.info(`Cleanup complete — deleted ${count} expired room(s).`);
    } else {
      logger.info('Cleanup complete — no expired rooms found.');
    }
  } catch (err) {
    logger.error('Room cleanup failed:', err);
  }
});


// ── 2. STRIPE WEBHOOK ─────────────────────────────────────────────────────────
// Called by Stripe when a payment completes.
// Sets users/{uid}/paid = true so the app unlocks room creation for that user.
//
// TO WIRE UP:
//   1. Deploy this function: firebase deploy --only functions
//   2. Copy the function URL from the Firebase console
//      (looks like https://us-central1-sidekick-tracker.cloudfunctions.net/stripeWebhook)
//   3. In Stripe Dashboard → Webhooks → Add endpoint
//      - Paste the URL above
//      - Select event: checkout.session.completed
//   4. Copy the Signing Secret and run:
//      firebase functions:secrets:set STRIPE_WEBHOOK_SECRET

exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    // Lazy-load Stripe so the function only pays for it when called
    const Stripe = require('stripe');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    const sig  = req.headers['stripe-signature'];
    const body = req.rawBody;

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        sig,
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (err) {
      logger.error('Stripe webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Only handle completed checkout sessions
    if (event.type !== 'checkout.session.completed') {
      return res.status(200).send('OK');
    }

    const session = event.data.object;

    // client_reference_id is the Firebase UID we pass when building the Stripe URL
    const uid = session.client_reference_id;
    if (!uid) {
      logger.error('No client_reference_id on session — cannot identify user.', session.id);
      return res.status(200).send('OK'); // Return 200 so Stripe doesn't retry
    }

    try {
      const db = getDatabase();
      await db.ref(`users/${uid}/paid`).set(true);
      await db.ref(`users/${uid}/purchasedAt`).set(Date.now());
      await db.ref(`users/${uid}/stripeSessionId`).set(session.id);
      logger.info(`User ${uid} marked as paid (session: ${session.id})`);
    } catch (err) {
      logger.error(`Failed to mark user ${uid} as paid:`, err);
      return res.status(500).send('Database error');
    }

    return res.status(200).send('OK');
  }
);
