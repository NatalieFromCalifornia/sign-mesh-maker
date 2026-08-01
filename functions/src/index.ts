import * as functions from 'firebase-functions';

// Placeholder. Server-side processing (e.g. Potrace-based vectorization or
// OpenCV-based inpainting) lands here if the client-side approach
// (imagetracerjs / OpenCV.js) proves insufficient. See requirements doc,
// section 9 (Algorithms & Libraries).

export const healthCheck = functions.https.onRequest((_req, res) => {
  res.status(200).send('ok');
});
