/**
 * How a form with a file chooser is sent to a server action.
 *
 * A form handed to React through its `action` prop is emptied when the
 * action finishes, and that empties its file choosers. After a failed read
 * (a wrong document, a blurry photo) the farmer would have to choose every
 * file again, not only the wrong one. Sent from `onSubmit` instead, inside a
 * transition, the form keeps what was chosen, and `useActionState` reports
 * the answer and the pending state the same way.
 *
 *   <form onSubmit={sendKeepingForm(submit)}>
 *
 * Safe in client components.
 */
import { startTransition, type SubmitEvent } from "react";

export function sendKeepingForm(submit: (formData: FormData) => void) {
  return (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Read the form now: by the time the transition runs, the event has been let go.
    const formData = new FormData(event.currentTarget);
    startTransition(() => submit(formData));
  };
}
