import { useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Overrides Expo Router's default per-route document (`@expo/router-server`'s own `Html`
// component, which this file's structure otherwise mirrors exactly) to avoid
// `ScrollViewStyleReset`'s inline `<style id="expo-reset">` -- xindeler-zuul's CSP (serving this
// app's Web build, ZG-58) has no `style-src 'self' 'unsafe-inline'`, and Matías chose to keep
// that CSP strict rather than loosen it (OC-38 design doc), so the reset is linked instead, from
// `public/expo-reset.css` (copied verbatim into the export output by Expo's own `public/`
// convention -- confirmed via `copyPublicFolderAsync`, unaffected by the SSG-vs-SPA distinction
// that made `public/index.html` itself inert).
export default function Root({ children }: PropsWithChildren) {
  const { bodyAttributes, bodyNodes, htmlAttributes, headNodes } = useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <link rel="stylesheet" href="/expo-reset.css" />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
