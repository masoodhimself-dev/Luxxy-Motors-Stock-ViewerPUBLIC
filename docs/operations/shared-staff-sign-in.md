# Shared staff sign-in rollout

DealerOS uses one production Clerk app and one Google sign-in connection on
`staff.dealeros.uk`. Dealership staff need an invitation and an active membership
for each workspace. An existing dealership portal remains available on its own
domain throughout the rollout.

## Prepare Google publication

1. Preview the staff sign-in information and privacy notice on `/about` and
   `/privacy`. Check the business identity, public privacy contact and notice
   against actual use. For the staff host, enable these pages with
   `STAFF_PORTAL_PUBLIC_INFO_ENABLED=true`. They do not unlock the staff area.
2. Set those two public URLs in Google Auth Platform → Branding, check the
   authorized domain and sender shown to users, and keep Google access limited
   to OpenID Connect identity, email and profile. In Audience, publish and
   verify the status. Complete brand verification if required for the consent
   screen. No separate dealer domains, Google projects or paid connectors.
3. Keep the legacy sign-in and Clerk credentials in place. Do not reset or
   replace staff passwords, send unrequested bulk invitations or link accounts
   automatically based on a matching address.

## Add a batch

1. Set `STAFF_PORTAL_DEALER_IDS` to the current cohort plus the next dealership
   IDs. Keep the pilot in this comma-separated list. When unset or blank, the
   prior `STAFF_PORTAL_PILOT_DEALER_ID` setting still works. Private demos,
   Website Only, suspended and draft workspaces cannot open the shared portal.
2. On the dealership portal, an owner can open **Settings → Team & access**,
   choose **Add shared sign-in** on the existing staff record, and send the link.
   The invitee must sign in with the verified address on the invitation and
   accept. The shared identity uses the role and assignments of the selected
   staff record. New staff can instead receive a regular invitation for either
   supported sign-in.
3. Check the same pilot staff member through each sign-in route before widening.
   Check role restrictions, an unavailable dealership and an uninvited or
   revoked account. Use authorized test accounts and existing records without
   sending any customer messages or updating live stock. Check the audit result
   before extending the scope. `*` means all eligible dealers, including future
   Full Portal dealerships. It does not grant memberships.
4. If a batch needs rolling back, restore the last known eligible scope. Leave
   the original sign-ins in place. Previously issued shared links for excluded
   dealerships become unavailable until the scope is restored; legacy links
   and roles stay intact.

Clerk's [Hobby plan](https://clerk.com/pricing) currently includes 50,000 monthly
retained users per app. A returning staff account counts once per month on this
app even if it works at more than one dealership.
