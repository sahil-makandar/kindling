CREATE TABLE "llm_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"cache_key" text NOT NULL,
	"output" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_outputs_run_key_unique" UNIQUE("run_id","cache_key")
);
--> statement-breakpoint
ALTER TABLE "llm_outputs" ADD CONSTRAINT "llm_outputs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;