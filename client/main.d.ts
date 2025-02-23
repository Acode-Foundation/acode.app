/// <reference path="../node_modules/html-tag-js/index.d.ts" />

declare namespace JSX {
  interface IntrinsicElements {
    [el: string]: HTMLElement;
  }
}

interface Router {
  add(path: String, callback: () => void): void;
  listen(): void;
  navigate(url: String): void;
  /**
   * Add event listener to router.
   * @param event Name of event to add listener to
   * @param listener Callback function
   */
  on(
    event: 'nagivate',
    listener: (url: String, changed: Boolean) => void
  ): void;
  /**
   * Remove event listener to router.
   * @param event Name of event to add listener to
   * @param listener Callback function
   */
  off(
    event: 'nagivate',
    listener: (url: String, changed: Boolean) => void
  ): void;
  onnavigate(url: String): void;
}

interface Order {
  Description: string;
  'Transaction Date': string;
  'Product Title': string;
  'Amount (Merchant Currency)': string;
  'Amount (Buyer Currency)': string;
  'Merchant Currency': string;
  'Buyer Currency': string;
}

declare const app: HTMLDivElement;
declare const main: HTMLDivElement;
declare const ADMIN: number;
