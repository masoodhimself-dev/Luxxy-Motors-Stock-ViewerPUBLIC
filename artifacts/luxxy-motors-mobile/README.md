# Luxxy Motors Mobile

Native iOS and Android companion app for the Luxxy Motors showroom. The app
uses the public, generated API client from `@workspace/api-client-react`; it
does not contain an inventory cache, dealer portal, importer, sales, or signing
flow.

## Local development

From the workspace root:

```bash
pnpm install
pnpm --filter @workspace/luxxy-motors-mobile run dev
```

The managed Expo workflow supplies `EXPO_PUBLIC_DOMAIN` from the current
Replit development domain. For a local API server or another environment,
set the non-secret `EXPO_PUBLIC_DOMAIN` to the API host (without a trailing
slash), for example:

```bash
EXPO_PUBLIC_DOMAIN=your-api-host.example pnpm --filter @workspace/luxxy-motors-mobile run dev
```

The client calls `/api/stock`, `/api/vehicles/:id`,
`/api/enquiries/availability`, and `POST /api/enquiries` through the shared
generated client. No API key or secret is needed by the customer app.

## Device and emulator smoke path

1. Start the managed `artifacts/luxxy-motors-mobile: expo` workflow.
2. Open **Preview on your phone** or scan the Expo QR code with Expo Go.
3. On iOS, use the Camera app for the QR code; on Android, use Expo Go.
4. At approximately 375–430 px wide, verify:
   - showroom stock loads, pull-to-refresh works, and search, make, and HPI
     clear filters update the two-column list;
   - a vehicle card opens a swipeable gallery and displays price, mileage,
     facts, damage disclosure, availability, call, WhatsApp, and directions;
   - booking shows London dates, API-backed 30-minute slots, validation,
     success confirmation, and a recoverable stale-slot/error path;
   - delivery, warranty, part exchange, and general enquiry forms validate and
     submit;
   - back navigation, keyboard scrolling, external links, and empty/offline
     states are usable.
5. Repeat the detail and booking checks on an Android emulator or device.

The deep-link scheme is `luxxy-motors-mobile`. Expo Router supports routes such
as `/vehicle/<vehicle-id>` and `/booking`; a vehicle booking link can include
`vehicleId` and `vehicleTitle` query parameters.

## Validation

```bash
pnpm --filter @workspace/luxxy-motors-mobile run typecheck
pnpm --filter @workspace/luxxy-motors-mobile run build
pnpm --filter @workspace/luxxy-motors-mobile exec expo install --check
cd artifacts/luxxy-motors-mobile && pnpm dlx expo-doctor@latest
```

The build command creates static Expo Go deployment bundles for both iOS and
Android. It is a validation/export step only and does not publish or change
production data.

## Release preparation

App Store and Google Play release work is intentionally not included. Before a
release, configure the final iOS bundle identifier and Android application
package, create platform signing credentials, review privacy and contact
metadata, test production API configuration, and complete each store’s
submission requirements. Do not commit credentials or secrets to this package.