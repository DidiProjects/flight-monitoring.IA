import type { Page } from 'playwright';

/**
 * Tenta aceitar/fechar qualquer banner de cookies ou LGPD.
 * Cobre os padrões mais comuns de CMPs (OneTrust, CookieBot, LGPD customizado).
 * Falha silenciosamente se nenhum botão for encontrado — não bloqueia o fluxo.
 */
export async function acceptCookies(page: Page): Promise<boolean> {
  // Estratégias ordenadas por especificidade — mais específicas primeiro
  const strategies: Array<{ description: string; selector: string }> = [
    // ── Texto exato (PT-BR / EN) ──────────────────────────────────────────────
    { description: 'text:Aceitar todos os cookies', selector: 'button:text-is("Aceitar todos os cookies")' },
    { description: 'text:Aceitar todos',            selector: 'button:text-is("Aceitar todos")' },
    { description: 'text:Aceitar tudo',             selector: 'button:text-is("Aceitar tudo")' },
    { description: 'text:Aceitar',                  selector: 'button:text-is("Aceitar")' },
    { description: 'text:Accept all cookies',       selector: 'button:text-is("Accept all cookies")' },
    { description: 'text:Accept all',               selector: 'button:text-is("Accept all")' },
    { description: 'text:Accept',                   selector: 'button:text-is("Accept")' },
    { description: 'text:Concordo',                 selector: 'button:text-is("Concordo")' },
    { description: 'text:Entendi',                  selector: 'button:text-is("Entendi")' },
    { description: 'text:OK',                       selector: 'button:text-is("OK")' },
    { description: 'text:Allow all',                selector: 'button:text-is("Allow all")' },

    // ── OneTrust (CMP mais usado globalmente) ─────────────────────────────────
    { description: 'OneTrust:accept-btn',           selector: '#onetrust-accept-btn-handler' },
    { description: 'OneTrust:pc-btn-handler',       selector: '.onetrust-accept-btn-handler' },

    // ── CookieBot ─────────────────────────────────────────────────────────────
    { description: 'CookieBot:accept',              selector: '#CybotCookiebotDialogBodyButtonAccept' },

    // ── Padrões genéricos por atributo ────────────────────────────────────────
    { description: 'aria-label:accept-cookies',     selector: '[aria-label*="accept" i][aria-label*="cookie" i]' },
    { description: 'data-testid:cookie-accept',     selector: '[data-testid*="cookie" i][data-testid*="accept" i]' },
    { description: 'data-testid:accept-all',        selector: '[data-testid*="accept-all" i]' },

    // ── Containers de cookie com botão primário ───────────────────────────────
    { description: 'cookie-banner:primary-btn',     selector: '[id*="cookie" i] button[class*="primary" i], [class*="cookie-banner" i] button[class*="primary" i]' },
    { description: 'consent-banner:primary-btn',    selector: '[id*="consent" i] button[class*="primary" i], [class*="consent" i] button[class*="primary" i]' },
    { description: 'lgpd-banner:primary-btn',       selector: '[id*="lgpd" i] button, [class*="lgpd" i] button' },

    // ── Texto parcial como último recurso ─────────────────────────────────────
    { description: 'text-contains:aceitar',         selector: 'button:has-text("ceitar")' },
    { description: 'text-contains:accept',          selector: 'button:has-text("ccept")' },
  ];

  for (const { description, selector } of strategies) {
    try {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 800 });
      if (!visible) continue;

      await el.click({ timeout: 3_000 });
      await page.waitForTimeout(600);
      return true;
    } catch {
      // Estratégia não encontrou nada — tenta a próxima
    }
  }

  return false;
}
