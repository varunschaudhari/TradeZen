import mongoose from 'mongoose';

const priceAlertSchema = new mongoose.Schema(
  {
    symbol:      { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z]{1,20}$/ },
    targetPrice: { type: Number, required: true, min: 0.01 },
    direction:   { type: String, required: true, enum: ['above', 'below'] },
    note:        { type: String, default: '', maxlength: 100, trim: true },
    active:      { type: Boolean, default: true },
    triggeredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('PriceAlert', priceAlertSchema);
