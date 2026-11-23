import './style.scss';

const policies = [
  { id: 'terms-of-service', href: '/terms', label: 'Terms' },
  { id: 'privacy-policy', href: '/policy', label: 'Privacy' },
  { id: 'refund-policy', href: '/refund', label: 'Refunds' },
];

export default function PolicyPage({ id }, children) {
  const article = <article className='policy-copy'>{children}</article>;
  const headings = Array.from(article.querySelectorAll('h2'));
  for (const heading of headings) {
    heading.id = `${id}-${heading.textContent
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-$/, '')}`;
    heading.tabIndex = -1;
  }

  function contents() {
    return (
      <nav aria-label='On this page'>
        {headings.map((heading) => (
          <a
            href={`#${heading.id}`}
            onclick={(event) => {
              // These anchors scroll within the page instead of entering the SPA router.
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.closest('details')?.removeAttribute('open');
              heading.focus({ preventScroll: true });
              heading.scrollIntoView({ block: 'start' });
            }}
          >
            {heading.textContent}
          </a>
        ))}
      </nav>
    );
  }

  return (
    <section id={id} className='policy-page'>
      <nav className='policy-pages' aria-label='Legal policies'>
        {policies.map((policy) => (
          <a href={policy.href} aria-current={id === policy.id ? 'page' : undefined}>
            {policy.label}
          </a>
        ))}
      </nav>
      <details className='policy-mobile-contents'>
        <summary>On this page</summary>
        {contents()}
      </details>
      <div className='policy-layout'>
        {article}
        <aside className='policy-sidebar'>
          <p>On this page</p>
          {contents()}
        </aside>
      </div>
    </section>
  );
}
