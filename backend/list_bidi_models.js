const key = 'AIzaSyCqM8JcmkmAlCz850U2oidzTj4qzwZ-WJA';

async function listSupportedModels() {
  const url = `https://generativelanguage.googleapis.com/v1alpha/models?key=${key}`;
  console.log(`Fetching models from ${url}...`);

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      console.error('Error fetching models:', data);
      return;
    }
    
    console.log('\nAll Available Models & Methods:\n');
    for (const model of data.models || []) {
      const bidi = model.supportedGenerationMethods?.includes('bidiGenerateContent');
      console.log(`- Model: ${model.name}`);
      console.log(`  Display Name: ${model.displayName}`);
      console.log(`  Supported Methods: ${model.supportedGenerationMethods?.join(', ')}`);
      if (bidi) {
        console.log(`  >>> SUPPORTS bidiGenerateContent! <<<`);
      }
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

listSupportedModels();
