/** Keep Vite's URL-module marker explicit for the classic script asset. */
declare module 'html2canvas/dist/html2canvas.min.js?url&import' {
  const url: string;
  export default url;
}
