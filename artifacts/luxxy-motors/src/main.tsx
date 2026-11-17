import { captureInvitationToken } from '@/lib/account-invitation-token';
import { captureStockAlertToken } from '@/lib/stock-alert-token';
import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { privateWebsitePreviewBase } from '@/lib/private-website-preview';
import { sharedStaffPortalPage } from '@/lib/shared-staff-portal';

import './index.css';

const previewBase = privateWebsitePreviewBase();
setBaseUrl(previewBase || sharedStaffPortalPage()?.base || null);
if (!previewBase) {
  captureInvitationToken();
  captureStockAlertToken();
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App previewBase={previewBase} />
  </ErrorBoundary>,
);
