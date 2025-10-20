/**
 * This is a unified serverless function that acts as a secure intermediary for all seats.io API calls.
 * It is designed to be deployed on a platform like Netlify or Vercel.
 *
 * It handles two primary actions determined by the 'action' property in the POST request body:
 * 1. `createHoldToken`: Generates a temporary session token for a user to interact with the chart.
 * 2. `bookSeat`: Receives a secure webhook from GoHighLevel after a successful payment to finalize a booking.
 */

// We use the native 'fetch' API, available in modern Node.js environments like Netlify Functions.
// No external dependencies are needed for this function.

exports.handler = async function(event) {
  // --- CORS Configuration ---
  // These headers are essential to allow your GoHighLevel funnel page to call this function from the browser.
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // IMPORTANT: For production, lock this down to your specific funnel domain.
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // --- Preflight Request Handling ---
  // Browsers will send an OPTIONS request first to check CORS policy.
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204, // "No Content" success status for preflight requests
      headers: corsHeaders,
      body: ''
    };
  }

  // --- Environment Variables ---
  // These must be set in your Netlify project's settings for security. Never hardcode secrets.
  const SEATSIO_SECRET_KEY = process.env.SEATSIO_SECRET_KEY;
  const SEATSIO_EVENT_KEY = process.env.SEATSIO_EVENT_KEY;
  const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET;

  // --- Main Logic ---
  try {
    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    // ACTION 1: Create a temporary hold token for the front-end chart.
    if (action === 'createHoldToken') {
      const response = await fetch('https://api.seats.io/hold-tokens', {
        method: 'POST',
        headers: {
          // btoa() is a standard function for Base64 encoding.
          'Authorization': `Basic ${btoa(SEATSIO_SECRET_KEY + ':')}`
        }
      });

      if (!response.ok) {
        throw new Error(`seats.io API error: ${await response.text()}`);
      }
      
      const { holdToken } = await response.json();
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ holdToken, eventKey: SEATSIO_EVENT_KEY })
      };
    }

    // ACTION 2: Securely book a seat after receiving a GHL webhook.
    if (action === 'bookSeat') {
      // Security Check: Verify the secret token sent by the GHL webhook.
      const authHeader = event.headers.authorization;
      if (authHeader !== `Bearer ${GHL_WEBHOOK_SECRET}`) {
        return { statusCode: 401, body: 'Unauthorized' };
      }
      
      const { seatId, holdToken } = body;
      if (!seatId || !holdToken) {
        throw new Error('Missing required parameters: seatId or holdToken.');
      }

      const bookResponse = await fetch(`https://api.seats.io/events/${SEATSIO_EVENT_KEY}/actions/book`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(SEATSIO_SECRET_KEY + ':')}`
        },
        body: JSON.stringify({
          objects: [seatId], // seats.io expects an array of objects to book
          holdToken: holdToken
        })
      });

      if (!bookResponse.ok) {
        throw new Error(`seats.io API error during booking: ${await bookResponse.text()}`);
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, message: `Seat ${seatId} booked successfully.` })
      };
    }

    // If the 'action' is not recognized
    throw new Error('Invalid action specified in request body.');

  } catch (err) {
    // Generic error handler for any failure in the try block
    console.error('Function Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};

