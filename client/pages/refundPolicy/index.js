import './style.scss';
import { marked } from 'marked';
import refundPolicy from './refund-policy.md';

export default async function RefundPolicy() {
  return (
    <section id='refund-policy'>
      <article innerHTML={marked(refundPolicy)} />
    </section>
  );
}
