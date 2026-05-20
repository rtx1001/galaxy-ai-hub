import { useEffect, useState } from "react";

export function useDateTimeLine() {
  const [dateTimeLine, setDateTimeLine] = useState("");

  useEffect(() => {
    const updateDateTime = () => {
      setDateTimeLine(
        new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date()),
      );
    };
    updateDateTime();
    const handle = window.setInterval(updateDateTime, 60_000);
    return () => window.clearInterval(handle);
  }, []);

  return dateTimeLine;
}
