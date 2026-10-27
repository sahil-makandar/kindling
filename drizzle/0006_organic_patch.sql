ALTER TABLE "venues" ADD COLUMN "matched_address" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "address_alternatives" jsonb;