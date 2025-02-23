import './style.scss';
import { marked } from 'marked';
import websitePP from './website-pp.md';

export default async function PrivacyPolicy() {
  return (
    <section id='privacy-policy'>
      <article innerHTML={marked(websitePP)} />
    </section>
  );
}
