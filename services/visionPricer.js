/**
 * AI Vision Pricing Service
 *
 * Analyses customer-uploaded photos using Claude Vision API to determine
 * a single fixed price for exterior cleaning jobs.
 * Cross-references photos with the pricing config and quote details.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getPricingConfig } = require('./pricingConfig');
const log = require('./logger').child('VisionPricer');

const client = new Anthropic();

/**
 * Analyse uploaded photos and determine a fixed price
 * @param {Object} supabase - Supabase client
 * @param {string} quoteId - Quote UUID
 * @returns {Promise<Object>} { success, finalPrice, confidence, reasoning, flags, error }
 */
async function analysePhotosAndPrice(supabase, quoteId) {
  try {
    log.info('Starting photo analysis', { quoteId });

    // 1. Fetch quote data
    const { data: quote, error: quoteErr } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .single();

    if (quoteErr || !quote) {
      throw new Error('Quote not found: ' + (quoteErr?.message || 'no data'));
    }

    // 2. Fetch photos from Supabase Storage
    const { data: files, error: listErr } = await supabase.storage
      .from('quote-attachments')
      .list(quoteId, { limit: 10 });

    if (listErr) {
      throw new Error('Failed to list photos: ' + listErr.message);
    }

    // Filter for customer-uploaded photos only
    const customerPhotos = (files || []).filter(f =>
      f.name.startsWith('customer-') &&
      /\.(jpg|jpeg|png|webp)$/i.test(f.name)
    );

    if (customerPhotos.length === 0) {
      throw new Error('No customer photos found for this quote');
    }

    log.info('Found photos', { quoteId, count: customerPhotos.length });

    // 3. Download photo buffers
    const photoBuffers = [];
    for (const file of customerPhotos.slice(0, 10)) {
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('quote-attachments')
        .download(`${quoteId}/${file.name}`);

      if (dlErr || !fileData) {
        log.warn('Failed to download photo', { quoteId, file: file.name, error: dlErr?.message });
        continue;
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      const ext = file.name.split('.').pop().toLowerCase();
      const mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

      photoBuffers.push({ buffer, mediaType, name: file.name });
    }

    if (photoBuffers.length === 0) {
      throw new Error('Could not download any photos');
    }

    // 4. Load pricing config
    const pricingConfig = await getPricingConfig();

    // 5. Build Claude API request
    const services = (quote.services || []);
    const answers = quote.answers || {};
    const estimateMin = Number(quote.estimated_value_min) || 0;
    const estimateMax = Number(quote.estimated_value_max) || 0;

    const imageBlocks = photoBuffers.map(p => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: p.mediaType,
        data: p.buffer.toString('base64')
      }
    }));

    const textPrompt = `You are a pricing specialist for Revive Exterior Cleaning, an exterior cleaning business in Swansea, South Wales.

Analyse these ${photoBuffers.length} photo(s) of a customer's property and determine a single fixed price for the requested services.

QUOTE DETAILS:
- Services requested: ${services.join(', ')}
- Property type: ${answers.propertyType || 'unknown'}
- Size description: ${answers.roughSize || 'unknown'}
- Last cleaned: ${answers.lastCleaned || 'unknown'}
- Customer notes: "${answers.specificDetails || 'none provided'}"
- Access notes: "${answers.accessNotes || 'none provided'}"
- Our rule-based estimate range: £${estimateMin} - £${estimateMax}

PRICING RULES (from our business config):
${JSON.stringify(pricingConfig.SERVICE_PRICING, null, 2)}

MODIFIERS:
${JSON.stringify(pricingConfig.MODIFIERS, null, 2)}

ANALYSE THE PHOTOS FOR:
1. Actual property size visible (compare to form description)
2. Condition/dirt level of surfaces to be cleaned (moss, algae, staining, general grime)
3. Accessibility (scaffolding needed? narrow access? height issues?)
4. Material types (concrete, block paving, natural stone, tiles, render type, UPVC)
5. Complexity factors (conservatory, dormer windows, multiple roof levels, extensions)
6. Any issues the customer hasn't mentioned

PRICING GUIDELINES:
- Your price should reflect realistic market rates for exterior cleaning in South Wales
- The rule-based estimate range is an anchor — your price should usually fall within or near it
- If photos reveal the job is easier than described, price lower
- If photos reveal additional complexity, price higher
- Round to the nearest £5
- Be fair — price what you see, not the maximum

Return ONLY valid JSON (no markdown, no code fences):
{
  "finalPrice": <number, single price in GBP rounded to nearest £5>,
  "confidence": <number, 0.0-1.0>,
  "reasoning": "<2-3 sentences explaining key pricing factors>",
  "sizeAssessment": "<small|medium|large>",
  "conditionScore": <1-5, where 1=clean and 5=heavily soiled>,
  "accessDifficulty": <1-5, where 1=easy and 5=very difficult>,
  "flags": [<array of notable observations as strings>],
  "suggestedAdjustments": "<any notes about what might change on-site>"
}`;

    const contentBlocks = [...imageBlocks, { type: 'text', text: textPrompt }];

    log.info('Calling Claude Vision API', { quoteId, photoCount: photoBuffers.length });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: contentBlocks
      }]
    });

    // 6. Parse response
    const responseText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    let result;
    try {
      // Strip any accidental markdown fences
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      log.error('Failed to parse AI response', { quoteId, response: responseText.substring(0, 500) });
      throw new Error('AI returned invalid JSON');
    }

    // 7. Validate and apply guardrails
    const finalPrice = Number(result.finalPrice);
    const confidence = Number(result.confidence);

    if (isNaN(finalPrice) || finalPrice <= 0) {
      throw new Error('AI returned invalid price: ' + result.finalPrice);
    }

    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      result.confidence = 0.5; // Default to medium confidence
    }

    // Guardrail: price must be within 50%-200% of estimate range
    const lowerBound = estimateMin * 0.5;
    const upperBound = estimateMax * 2.0;

    if (finalPrice < lowerBound || finalPrice > upperBound) {
      log.warn('AI price outside guardrails', {
        quoteId, finalPrice, lowerBound, upperBound, estimateMin, estimateMax
      });

      // Fall back to midpoint of estimate range with low confidence
      const midpoint = Math.round(((estimateMin + estimateMax) / 2) / 5) * 5;
      return {
        success: true,
        finalPrice: midpoint,
        confidence: 0.3,
        reasoning: `AI suggested £${finalPrice} which was outside acceptable range (£${lowerBound}-£${upperBound}). Defaulted to midpoint of estimate range. Manual review recommended.`,
        flags: ['price_guardrail_triggered', ...(result.flags || [])],
        sizeAssessment: result.sizeAssessment || 'medium',
        conditionScore: result.conditionScore || 3,
        accessDifficulty: result.accessDifficulty || 2,
        suggestedAdjustments: result.suggestedAdjustments || '',
        aiVersion: 'vision-v1-guardrail'
      };
    }

    // Round to nearest £5
    const roundedPrice = Math.round(finalPrice / 5) * 5;

    log.info('Photo analysis complete', {
      quoteId,
      finalPrice: roundedPrice,
      confidence: result.confidence,
      estimateRange: `£${estimateMin}-£${estimateMax}`
    });

    return {
      success: true,
      finalPrice: roundedPrice,
      confidence: result.confidence,
      reasoning: result.reasoning || '',
      flags: result.flags || [],
      sizeAssessment: result.sizeAssessment || 'medium',
      conditionScore: result.conditionScore || 3,
      accessDifficulty: result.accessDifficulty || 2,
      suggestedAdjustments: result.suggestedAdjustments || '',
      aiVersion: 'vision-v1'
    };

  } catch (error) {
    log.error('Photo analysis failed', { quoteId, error: error.message });

    return {
      success: false,
      error: error.message,
      finalPrice: null,
      confidence: 0,
      reasoning: 'Analysis failed: ' + error.message,
      flags: ['analysis_failed'],
      aiVersion: 'vision-v1-error'
    };
  }
}

module.exports = {
  analysePhotosAndPrice
};
