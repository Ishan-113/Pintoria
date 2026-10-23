import { SetMetadata } from '@nestjs/common';

export const PRICING_FIELDS_KEY = 'pricingFields';

/** Declares additional DTO properties that count as pricing data.
 *  They are stripped from responses for users without `pricing.view`
 *  (on top of the standard pricing keys). */
export const PricingField = (...fields: string[]) => SetMetadata(PRICING_FIELDS_KEY, fields);
