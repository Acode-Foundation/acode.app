import './style.scss';
import { marked } from 'marked';
import websiteTS from './website-ts.md';

export default async function TermsOfService() {
  return <section id='terms-of-service'>
    <article innerHTML={marked(websiteTS)}></article>
  </section>;
}
