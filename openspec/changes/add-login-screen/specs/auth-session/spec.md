# Spec Delta

## Purpose

Defines how a person signs in to the QA Platform, how the session is kept and ended, and which pages require a session.

## ADDED Requirements

### Requirement: Login form validation
The login screen SHALL ask for an email and a password and SHALL NOT submit until the email is a valid address and the password is not empty. Each invalid field SHALL show its own message once the user has interacted with it or attempted to submit.

#### Scenario: Empty submit
- **WHEN** the user submits the form with both fields empty
- **THEN** no sign-in attempt is made and both fields show a "required" message

#### Scenario: Malformed email
- **WHEN** the user enters `not-an-email` and submits
- **THEN** no sign-in attempt is made and the email field shows an invalid-email message

### Requirement: Single sign-in attempt at a time
While a sign-in attempt is in progress the submit control SHALL be disabled and show a busy state, and further submits (second click, Enter) SHALL NOT start another attempt.

#### Scenario: Double submit
- **WHEN** the user submits valid credentials twice in quick succession
- **THEN** exactly one sign-in attempt is made

### Requirement: Successful sign-in
On a successful sign-in the system SHALL keep the session for the current browser session and SHALL navigate to the page the user originally requested, or to the home page when none was requested.

#### Scenario: Return to requested page
- **WHEN** an unauthenticated user opens a protected page, is sent to login and signs in successfully
- **THEN** the user lands on the page they originally requested

#### Scenario: Reload keeps the session
- **WHEN** a signed-in user reloads the page in the same browser tab
- **THEN** the user is still signed in

### Requirement: Failed sign-in
When the provider rejects the credentials or cannot be reached, the system SHALL stay on the login screen, re-enable the form and show an error message announced to assistive technology, without clearing the email.

#### Scenario: Rejected credentials
- **WHEN** the provider rejects the sign-in
- **THEN** an error message is shown, the email is kept and the user can retry

### Requirement: Protected pages
Every page except the login screen SHALL require a session. A request to a protected page without a session SHALL redirect to the login screen carrying the requested path. A signed-in user who opens the login screen SHALL be redirected to the home page.

#### Scenario: Unauthenticated access
- **WHEN** a user without a session opens the home page
- **THEN** the login screen is shown

#### Scenario: Signed-in user opens login
- **WHEN** a signed-in user opens the login screen
- **THEN** the user is redirected to the home page

### Requirement: Sign-out
A signed-in user SHALL be able to sign out; signing out SHALL end the session and show the login screen.

#### Scenario: Sign out
- **WHEN** the user chooses sign out
- **THEN** the session ends and the login screen is shown

### Requirement: Provisional provider is visible
Until the authentication provider is decided, the login screen SHALL display a visible notice that sign-in is a development stub, so nobody mistakes it for real authentication.

#### Scenario: Stub notice
- **WHEN** the login screen is rendered with the stub provider
- **THEN** a notice states that authentication is a development stub
