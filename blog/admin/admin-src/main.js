// Einstiegspunkt des Admins.
//
// Die Module hier waren bis zum 2026-08-23 aneinandergeklebte .part-Fragmente in einer einzigen
// Closure: 490 Bezeichner, die alle einander sahen, sortiert über Zahlen im Dateinamen. Jetzt
// sagt jede Datei, was sie braucht und was sie anbietet, und esbuild bündelt daraus dasselbe
// wie zuvor — nur ist der Geltungsbereich jetzt real und nicht mehr eine Verabredung.
//
// 30-init.js ruft init() beim Auswerten auf und zieht über seine Importe alles Übrige mit.
import "./30-init.js";
