"use client";

/**
 * "Download report" — opens the browser's print dialog, where the destination
 * is "Save as PDF".
 *
 * WHY NOT GENERATE A PDF SERVER-SIDE. A real .pdf download needs either a
 * headless browser in the function (too heavy for a serverless deployment and
 * slow enough that people click twice) or a drawing library, which means
 * laying the whole report out a second time in a different coordinate system
 * and keeping the two in step forever. Printing the page uses the layout that
 * is already on screen and already translated, so the PDF cannot drift from
 * what the coordinator just read.
 *
 * The page carries print styles that drop the chrome and keep the panels from
 * splitting across a page break, so the output is a document rather than a
 * screenshot of an app.
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn btn--forest rep__print" onClick={() => window.print()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </button>
  );
}
