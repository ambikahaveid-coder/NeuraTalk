import crypto from "crypto";
import {
  buildPool,
  withClient,
} from "./db-sre-lib.mjs";

function uniqueSuffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

async function main() {
  const pool = buildPool();
  const suffix = uniqueSuffix();

  try {
    const result = await withClient(pool, async (client) => {
      await client.query("BEGIN");

      try {
        const [planResult] = (
          await client.query(
            `select id from public.billing_plans order by id asc limit 1`,
          )
        ).rows;

        if (!planResult?.id) {
          throw new Error("billing_plans is empty; cannot run validation inserts");
        }

        const orgA = (
          await client.query(
            `
              insert into public.organizations (name, slug, status, is_active)
              values ($1, $2, 'approved', true)
              returning id, slug
            `,
            [`Tenant A ${suffix}`, `tenant-a-${suffix}`],
          )
        ).rows[0];

        const orgB = (
          await client.query(
            `
              insert into public.organizations (name, slug, status, is_active)
              values ($1, $2, 'approved', true)
              returning id, slug
            `,
            [`Tenant B ${suffix}`, `tenant-b-${suffix}`],
          )
        ).rows[0];

        const userA = (
          await client.query(
            `
              insert into public.users (username, email, role, organization_id, is_active)
              values ($1, $2, 'company_admin', $3, true)
              returning id, organization_id
            `,
            [`usera_${suffix}`, `usera_${suffix}@example.test`, orgA.id],
          )
        ).rows[0];

        const userB = (
          await client.query(
            `
              insert into public.users (username, email, role, organization_id, is_active)
              values ($1, $2, 'agent', $3, true)
              returning id, organization_id
            `,
            [`userb_${suffix}`, `userb_${suffix}@example.test`, orgB.id],
          )
        ).rows[0];

        const billingAccountA = (
          await client.query(
            `
              insert into public.billing_accounts (
                organization_id,
                assigned_plan_id,
                billing_type,
                wallet_balance_paise,
                locked_balance_paise,
                included_seconds_remaining
              )
              values ($1, $2, 'prepaid', 500000, 0, 1200)
              returning id, organization_id, wallet_balance_paise
            `,
            [orgA.id, planResult.id],
          )
        ).rows[0];

        const billingAccountB = (
          await client.query(
            `
              insert into public.billing_accounts (
                organization_id,
                assigned_plan_id,
                billing_type,
                wallet_balance_paise,
                locked_balance_paise,
                included_seconds_remaining
              )
              values ($1, $2, 'prepaid', 100000, 0, 600)
              returning id, organization_id, wallet_balance_paise
            `,
            [orgB.id, planResult.id],
          )
        ).rows[0];

        const apiKey = (
          await client.query(
            `
              insert into public.enterprise_api_keys (
                organization_id,
                key_hash,
                key_prefix,
                name,
                status
              )
              values ($1, $2, $3, $4, 'active')
              returning id, organization_id
            `,
            [
              orgA.id,
              `hash_${suffix}`,
              `nt_${suffix.slice(0, 6)}`,
              `Validation Key ${suffix}`,
            ],
          )
        ).rows[0];

        const apiPricing = (
          await client.query(
            `
              insert into public.communication_api_key_pricing (
                api_key_id,
                organization_id,
                billing_model,
                prepaid_balance_paise,
                voice_rate_per_second_paise,
                video_rate_per_second_paise
              )
              values ($1, $2, 'prepaid', 500000, 15, 25)
              returning id, organization_id
            `,
            [apiKey.id, orgA.id],
          )
        ).rows[0];

        const virtualNumber = (
          await client.query(
            `
              insert into public.communication_virtual_numbers (
                provider,
                phone_number,
                status
              )
              values ('msg91', $1, 'available')
              returning id, phone_number
            `,
            [`+9191${suffix.slice(0, 8)}`],
          )
        ).rows[0];

        const maskedMapping = (
          await client.query(
            `
              insert into public.communication_masked_number_mappings (
                session_id,
                virtual_number_id,
                api_key_id,
                organization_id,
                caller_real_number,
                callee_real_number,
                masked_number,
                expires_at
              )
              values ($1, $2, $3, $4, $5, $6, $7, now() + interval '10 minutes')
              returning id, organization_id
            `,
            [
              `mask_${suffix}`,
              virtualNumber.id,
              apiKey.id,
              orgA.id,
              "+919999000001",
              "+919999000002",
              virtualNumber.phone_number,
            ],
          )
        ).rows[0];

        const communicationSession = (
          await client.query(
            `
              insert into public.communication_sessions (
                session_id,
                api_key_id,
                organization_id,
                pricing_id,
                masked_mapping_id,
                caller_identity,
                callee_identity,
                call_type,
                transport,
                join_method,
                status
              )
              values ($1, $2, $3, $4, $5, $6, $7, 'voice', 'webrtc', 'app_to_app', 'active')
              returning id, session_id, organization_id
            `,
            [
              `sess_${suffix}`,
              apiKey.id,
              orgA.id,
              apiPricing.id,
              maskedMapping.id,
              `caller_${suffix}`,
              `callee_${suffix}`,
            ],
          )
        ).rows[0];

        await client.query(
          `
            insert into public.communication_session_events (
              session_id,
              event_type,
              payload
            )
            values ($1, 'created', '{"source":"db-post-validate"}'::jsonb)
          `,
          [communicationSession.session_id],
        );

        const reservation = (
          await client.query(
            `
              insert into public.billing_reservations (
                reservation_id,
                billing_account_id,
                organization_id,
                user_id,
                call_id,
                call_type,
                reserved_amount_paise,
                consumed_amount_paise
              )
              values ($1, $2, $3, $4, $5, 'voice', 1800, 900)
              returning id, reservation_id
            `,
            [
              `res_${suffix}`,
              billingAccountA.id,
              orgA.id,
              userA.id,
              communicationSession.session_id,
            ],
          )
        ).rows[0];

        const callRecord = (
          await client.query(
            `
              insert into public.call_billing_records (
                call_id,
                organization_id,
                billing_account_id,
                reservation_id,
                user_id,
                call_type,
                voice_seconds,
                total_cost_paise,
                prepaid_debit_paise,
                cost_breakdown,
                effective_pricing,
                status
              )
              values ($1, $2, $3, $4, $5, 'voice', 60, 900, 900, '{"voice":900}'::jsonb, '{"voicePerSecond":15}'::jsonb, 'completed')
              returning id, total_cost_paise
            `,
            [
              communicationSession.session_id,
              orgA.id,
              billingAccountA.id,
              reservation.reservation_id,
              userA.id,
            ],
          )
        ).rows[0];

        const ledgerEntry = (
          await client.query(
            `
              insert into public.billing_ledger_entries (
                billing_account_id,
                organization_id,
                reservation_id,
                call_id,
                user_id,
                entry_type,
                direction,
                amount_paise,
                balance_after_paise,
                metadata,
                created_by
              )
              values ($1, $2, $3, $4, $5, 'call_charge', 'debit', 900, 499100, '{"validated":true}'::jsonb, $5)
              returning id, amount_paise
            `,
            [
              billingAccountA.id,
              orgA.id,
              reservation.reservation_id,
              communicationSession.session_id,
              userA.id,
            ],
          )
        ).rows[0];

        await client.query(
          `
            insert into public.user_sessions (
              token,
              user_id,
              organization_id,
              tenant_slug,
              session_scope,
              expires_at
            )
            values ($1, $2, $3, $4, 'tenant', now() + interval '1 day')
          `,
          [`session_${suffix}`, userA.id, orgA.id, orgA.slug],
        );

        const isolationChecks = (
          await client.query(
            `
              select
                (select count(*)::int from public.billing_accounts where organization_id = $1) as billing_accounts_org_a,
                (select count(*)::int from public.billing_accounts where organization_id = $2) as billing_accounts_org_b,
                (select count(*)::int from public.call_billing_records where organization_id = $1) as call_records_org_a,
                (select count(*)::int from public.call_billing_records where organization_id = $2) as call_records_org_b,
                (select count(*)::int from public.communication_sessions where organization_id = $1) as communication_sessions_org_a,
                (select count(*)::int from public.communication_sessions where organization_id = $2) as communication_sessions_org_b
            `,
            [orgA.id, orgB.id],
          )
        ).rows[0];

        await client.query("ROLLBACK");

        return {
          orgA,
          orgB,
          userA,
          userB,
          billingAccountA,
          billingAccountB,
          apiKey,
          apiPricing,
          virtualNumber,
          maskedMapping,
          communicationSession,
          reservation,
          callRecord,
          ledgerEntry,
          isolationChecks,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    console.log(JSON.stringify({ ok: true, validation: result }, null, 2));
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
