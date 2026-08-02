import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the JARVIS assistant control center', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: /assistant console/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /assistant/i })).toBeInTheDocument();
});
