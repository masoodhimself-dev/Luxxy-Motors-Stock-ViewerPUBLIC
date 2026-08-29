import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dealerMembershipRoleEnum = pgEnum("dealer_membership_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);
export const dealerIntegrationStatusEnum = pgEnum("dealer_integration_status", [
  "pending",
  "active",
  "disabled",
  "error",
]);

export const organizationsTable = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const dealersTable = pgTable("dealers", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  legacyDealerId: text("legacy_dealer_id").unique(),
  timezone: text("timezone").notNull().default("Europe/London"),
  currency: text("currency").notNull().default("GBP"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("dealers_organization_slug_uidx").on(table.organizationId, table.slug),
  check("dealers_status_check", sql`${table.status} in ('active', 'inactive')`),
  check("dealers_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
]);

export const dealerDomainsTable = pgTable("dealer_domains", {
  id: uuid("id").primaryKey(),
  dealerId: uuid("dealer_id").notNull().references(() => dealersTable.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull().unique(),
  verified: boolean("verified").notNull().default(false),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("dealer_domains_dealer_id_idx").on(table.dealerId),
  check("dealer_domains_lowercase_hostname_check", sql`${table.hostname} = lower(${table.hostname})`),
]);

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("users_lowercase_email_check", sql`${table.email} = lower(${table.email})`),
]);

export const dealerMembershipsTable = pgTable("dealer_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealerId: uuid("dealer_id").notNull().references(() => dealersTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: dealerMembershipRoleEnum("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("dealer_memberships_dealer_user_uidx").on(table.dealerId, table.userId),
  index("dealer_memberships_user_id_idx").on(table.userId),
]);

export const integrationProvidersTable = pgTable("integration_providers", {
  id: uuid("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const dealerIntegrationsTable = pgTable("dealer_integrations", {
  id: uuid("id").primaryKey(),
  dealerId: uuid("dealer_id").notNull().references(() => dealersTable.id, { onDelete: "cascade" }),
  providerId: uuid("provider_id").notNull().references(() => integrationProvidersTable.id, { onDelete: "restrict" }),
  externalAccountId: text("external_account_id"),
  isPrimary: boolean("is_primary").notNull().default(false),
  status: dealerIntegrationStatusEnum("status").notNull().default("pending"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("dealer_integrations_id_dealer_unique").on(table.id, table.dealerId),
  uniqueIndex("dealer_integrations_dealer_provider_uidx").on(table.dealerId, table.providerId),
]);

export const integrationCollectorCredentialsTable = pgTable(
  "integration_collector_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerIntegrationId: uuid("dealer_integration_id").notNull().references(() => dealerIntegrationsTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    verifierHash: text("verifier_hash").notNull(),
    verifierSalt: text("verifier_salt").notNull(),
    hashAlgorithm: text("hash_algorithm").notNull().default("scrypt"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_collector_credentials_integration_label_uidx").on(table.dealerIntegrationId, table.label),
    check("integration_collector_credentials_hash_algorithm_check", sql`${table.hashAlgorithm} in ('scrypt', 'argon2id')`),
    check("integration_collector_credentials_verifier_format_check", sql`(
      ${table.hashAlgorithm} = 'scrypt'
      and ${table.verifierHash} ~ '^[a-f0-9]{128}$'
      and ${table.verifierSalt} ~ '^[a-f0-9]{32}$'
    ) or (
      ${table.hashAlgorithm} = 'argon2id'
      and ${table.verifierHash} like '$argon2id$%'
      and length(${table.verifierSalt}) >= 16
    )`),
  ],
);

export const insertOrganizationSchema = createInsertSchema(organizationsTable);
export const insertDealerSchema = createInsertSchema(dealersTable);
export const insertDealerDomainSchema = createInsertSchema(dealerDomainsTable);
export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true });
export const insertDealerMembershipSchema = createInsertSchema(dealerMembershipsTable).omit({ id: true });
export const insertIntegrationProviderSchema = createInsertSchema(integrationProvidersTable);
export const insertDealerIntegrationSchema = createInsertSchema(dealerIntegrationsTable);
export const insertIntegrationCollectorCredentialSchema = createInsertSchema(integrationCollectorCredentialsTable).omit({ id: true });

export type Organization = typeof organizationsTable.$inferSelect;
export type Dealer = typeof dealersTable.$inferSelect;
export type DealerDomain = typeof dealerDomainsTable.$inferSelect;
export type User = typeof usersTable.$inferSelect;
export type DealerMembership = typeof dealerMembershipsTable.$inferSelect;
export type IntegrationProvider = typeof integrationProvidersTable.$inferSelect;
export type DealerIntegration = typeof dealerIntegrationsTable.$inferSelect;
export type IntegrationCollectorCredential = typeof integrationCollectorCredentialsTable.$inferSelect;