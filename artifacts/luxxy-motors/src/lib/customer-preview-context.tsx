import { createContext, useContext } from 'react';

/** Opt-in only for script-free draft snapshots. Normal customer rendering is unchanged. */
export const CustomerPreviewContext = createContext<{ viewportWidth: number } | null>(null);
export const useCustomerPreview = () => useContext(CustomerPreviewContext);
