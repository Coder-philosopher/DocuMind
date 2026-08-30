# Acme Corporation — Data Security and Access Control Policy

Document owner: Office of the Chief Information Security Officer
Effective date: March 1, 2024
Classification: Internal

## 1. Purpose

This policy defines the minimum data security and access control requirements for all Acme Corporation systems that process, store, or transmit company data.

## 2. Data Classification

Data is classified into four tiers:

- **Tier 1 — Public**: Information approved for external release.
- **Tier 2 — Internal**: Information meant only for Acme employees.
- **Tier 3 — Confidential**: Customer data, financial results before public release, and trade secrets.
- **Tier 4 — Restricted**: Regulated data such as payment card information (PCI) and protected health information (PHI).

## 3. Access Control Requirements

All systems must enforce least-privilege access. Access to Tier 3 and Tier 4 data requires manager approval plus periodic re-certification every 90 days. Multi-factor authentication (MFA) is mandatory for any account that can read Tier 3 or Tier 4 data.

## 4. Encryption Requirements

Data at rest must be encrypted using AES-256 or equivalent. Data in transit must use TLS 1.2 or higher. Encryption keys must be rotated at least every 12 months.

## 5. Incident Response

Security incidents that involve Tier 3 or Tier 4 data must be reported to the CISO office within 4 hours of discovery. A written post-incident report is due within 5 business days.

## 6. Personal Data

The European Union General Data Protection Regulation (GDPR) applies to all personal data of EU residents. Data subject access requests must be fulfilled within 30 calendar days.

## 7. Consequences

Violations of this policy may result in disciplinary action up to and including termination of employment.