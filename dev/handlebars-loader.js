import Handlebars from 'handlebars';

export default (source) => {
  const template = Handlebars.precompile(source, {
    destName: 'index.html',
    knownHelpers: ['if'],
  });
  return `
  import Handlebars from 'handlebars/runtime';
  export default Handlebars.template(${template});
  `;
};
