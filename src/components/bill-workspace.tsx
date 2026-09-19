"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Copy,
  FileCheck2,
  FilePlus2,
  Heart,
  ImagePlus,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  Users,
  Utensils,
  X,
} from "lucide-react";
import {
  currencyDigits,
  demoBill,
  emptyBill,
  isBill,
  money,
  updateLineTotal,
  type Bill,
  type Currency,
  type splitBill,
} from "@/lib/bill";
import { parseReceipt, readReceiptLayout } from "@/lib/receipt";
import {
  findReceiptSeparators,
  prepareReceiptImage,
} from "@/lib/receipt-image";
import { canSplit, type Restaurant } from "@/lib/restaurants";
import { useConfirmation } from "@/components/confirmation-dialog";
import { useScrollNavigation } from "@/components/use-scroll-navigation";

type Split = ReturnType<typeof splitBill>;
type Worker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
const STORAGE_KEY = "hseb-please:bill:v1";
const COLORS = ["peach", "sage", "lavender", "blue", "yellow"];

function Avatar({
  name,
  index,
  small = false,
}: {
  name: string;
  index: number;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${COLORS[index % COLORS.length]} ${small ? "small" : ""}`}
    >
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

export function BillWorkspace({
  requireRestaurant,
}: {
  requireRestaurant: boolean;
}) {
  const { confirm, confirmationDialog } = useConfirmation();
  const scrollTo = useScrollNavigation();
  const [bill, setBill] = useState<Bill>(emptyBill);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(true);
  const [stage, setStage] = useState(0);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [language, setLanguage] = useState("eng+ara");
  const [scanLabel, setScanLabel] = useState("Reading your receipt");
  const [scanReview, setScanReview] = useState("");
  const [preview, setPreview] = useState("");
  const [rawText, setRawText] = useState("");
  const [detectedSubtotal, setDetectedSubtotal] = useState<number | null>(null);
  const [personName, setPersonName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [split, setSplit] = useState<Split | null>(null);
  const [splitting, setSplitting] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const generationRef = useRef(0);
  const revisionRef = useRef(0);
  const allowed = !requireRestaurant || (!!restaurant && canSplit(restaurant));
  const total = bill.items.reduce((sum, item) => sum + item.amount, 0);
  const missing =
    bill.mode === "items"
      ? bill.items.filter(
          (item) =>
            !item.personIds.some((id) => bill.people.some((p) => p.id === id)),
        ).length
      : 0;

  useEffect(() => {
    // Hydrate the browser-only draft after the server-rendered shell has mounted.
    const hydrate = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (isBill(parsed.bill)) {
            const { title, currency, people, items, mode } = parsed.bill;
            setBill({ title, currency, people, items, mode });
          }
          if (typeof parsed.restaurantName === "string")
            setRestaurantName(parsed.restaurantName);
          if (
            !new URLSearchParams(window.location.search).has("restaurant") &&
            typeof parsed.restaurantSlug === "string"
          ) {
            fetch(
              `/api/restaurants?slug=${encodeURIComponent(parsed.restaurantSlug)}`,
            )
              .then((r) => r.json())
              .then((data) => {
                if (data.restaurants?.[0]) setRestaurant(data.restaurants[0]);
              })
              .catch(() => {});
          }
        }
      } catch {
        setSaved(false);
      }
      const slug = new URLSearchParams(window.location.search).get(
        "restaurant",
      );
      if (slug) {
        fetch(`/api/restaurants?slug=${encodeURIComponent(slug)}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.restaurants?.[0]) setRestaurant(data.restaurants[0]);
            else {
              setError(
                data.error ||
                  "This restaurant hasn’t registered yet. Please wait for it to join Hseb Please.",
              );
              setRestaurant(null);
            }
          })
          .catch(() =>
            setError("We couldn’t verify this restaurant. Please try again."),
          );
      }
      setReady(true);
    };
    hydrate();
    return () => {
      // This is a cancellation counter, not a DOM ref; invalidate in-flight OCR.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generationRef.current++;
      void workerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const persist = () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            bill,
            restaurantSlug: restaurant?.slug,
            restaurantName,
          }),
        );
        setSaved(true);
      } catch {
        setSaved(false);
      }
    };
    persist();
  }, [bill, restaurant, restaurantName, ready]);

  useEffect(() => {
    if (!directoryOpen && !helpOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, a[href], [tabindex="0"]',
        ) ?? [],
      );
    (
      dialog?.querySelector<HTMLInputElement>("input") || focusable()[0]
    )?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A confirmation can sit above the directory; let that modal own focus.
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        setDirectoryOpen(false);
        setHelpOpen(false);
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [directoryOpen, helpOpen]);

  useEffect(() => {
    if (!directoryOpen) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setDirectoryLoading(true);
      setDirectoryError("");
      try {
        const response = await fetch(
          `/api/restaurants?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setRestaurants(data.restaurants);
      } catch (e) {
        if (!controller.signal.aborted) {
          setRestaurants([]);
          setDirectoryError(
            e instanceof Error ? e.message : "Couldn’t load restaurants.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setDirectoryLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [directoryOpen, query]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function goToStage(nextStage: number) {
    setStage(nextStage);
    scrollTo(["receipt-section", "people-section", "split-section"][nextStage]);
  }

  function addItem() {
    const id = crypto.randomUUID();
    updateBill((b) => ({
      ...b,
      items: [
        ...b.items,
        { id, name: "New item", quantity: 1, amount: 0, personIds: [] },
      ],
    }));
    scrollTo(`bill-item-${id}`, ".item-name input");
  }

  function updateBill(updater: (previous: Bill) => Bill) {
    revisionRef.current++;
    setBill(updater);
    setSplit(null);
    setError("");
    setNotice("");
    if (stage === 2) goToStage(1);
  }

  async function selectRestaurant(next: Restaurant) {
    if (
      restaurant &&
      restaurant.id !== next.id &&
      bill.items.length &&
      !(await confirm({
        title: "Move to a different table?",
        description: `Choosing ${next.name} will clear your current bill so you can start fresh.`,
        confirmLabel: "Change restaurant",
      }))
    )
      return;
    if (restaurant?.id !== next.id) {
      setBill(emptyBill());
      setSplit(null);
      goToStage(0);
      setPreview("");
      setRawText("");
      setScanReview("");
      setDetectedSubtotal(null);
    }
    setRestaurant(next);
    setDirectoryOpen(false);
    setError("");
  }

  async function newBill() {
    if (
      bill.items.length &&
      !(await confirm({
        title: "Ready for a fresh bill?",
        description:
          "Your current items, people, and saved draft will be cleared. Your next good meal starts here.",
        confirmLabel: "Start a new bill",
      }))
    )
      return;
    generationRef.current++;
    void workerRef.current?.terminate();
    workerRef.current = null;
    setBill(emptyBill());
    goToStage(0);
    setSplit(null);
    setPreview("");
    setRawText("");
    setScanReview("");
    setDetectedSubtotal(null);
    setError("");
    setNotice("");
    setScanning(false);
  }

  function applyReceipt(text: string, restaurantHint?: string | null) {
    const parsed = parseReceipt(text, bill.currency);
    setDetectedSubtotal(parsed.detectedSubtotal);
    if (!parsed.items.length) {
      setError(
        "We couldn’t find any line items. Try a clearer photo, edit the receipt text, or add items manually.",
      );
      return;
    }
    updateBill((previous) => ({
      ...previous,
      currency: parsed.currency,
      items: parsed.items,
    }));
    const detectedName = restaurantHint || parsed.restaurantName;
    if (!requireRestaurant && detectedName) setRestaurantName(detectedName);
    setNotice(
      "Receipt scanned. Check the item names and line totals before continuing.",
    );
    scrollTo("items-section");
  }

  async function processFile(file?: File) {
    if (!file || !allowed || scanning) return;
    if (
      !["image/jpeg", "image/png", "image/webp", "image/bmp"].includes(
        file.type,
      )
    ) {
      setError(
        "Please choose a JPG, PNG, WebP, or BMP image. For HEIC photos, export as JPG first.",
      );
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Choose an image smaller than 12 MB.");
      return;
    }
    if (
      bill.items.length &&
      !(await confirm({
        title: "Scan a new receipt?",
        description:
          "The new receipt will replace your current items once it has been read. Your people will stay at the table.",
        confirmLabel: "Scan new receipt",
      }))
    )
      return;
    setError("");
    setNotice("");
    setScanning(true);
    setScanReview("");
    setScanLabel("Straightening your receipt");
    setProgress(0);
    setPreview(URL.createObjectURL(file));
    const generation = ++generationRef.current;
    let worker: Worker | null = null;
    try {
      const [prepared, { createWorker, PSM }] = await Promise.all([
        prepareReceiptImage(file),
        import("tesseract.js"),
      ]);
      if (generation !== generationRef.current) return;
      const separators = findReceiptSeparators(prepared);
      setScanLabel("Reading your receipt");
      worker = await createWorker(language, 1, {
        logger: (message) => {
          if (
            generation === generationRef.current &&
            message.status === "recognizing text"
          )
            setProgress(Math.round(message.progress * 100));
        },
      });
      if (generation !== generationRef.current) return;
      workerRef.current = worker;
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      const result = await worker.recognize(
        prepared,
        { rotateAuto: true },
        { text: true, blocks: true },
      );
      if (generation !== generationRef.current) return;
      let layout = readReceiptLayout(result.data, separators);
      if (
        language.includes("ara") &&
        layout.uncertainNames &&
        /[\u0620-\u064a]/.test(layout.text)
      ) {
        setScanLabel("Checking Arabic item names");
        setProgress(0);
        // A second language-specific pass can clarify names. Prices and quantities
        // always come from the original multilingual pass, never this retry.
        await worker.reinitialize("ara");
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
        const arabicResult = await worker.recognize(
          prepared,
          { rotateAuto: true },
          { text: true, blocks: true },
        );
        if (generation !== generationRef.current) return;
        layout = readReceiptLayout(result.data, separators, arabicResult.data);
      }
      setScanReview(
        layout.uncertainNames
          ? "A few item names were unclear. Please check their spelling against your receipt before continuing."
          : "",
      );
      setRawText(layout.text);
      applyReceipt(layout.text, layout.restaurantName);
    } catch {
      if (generation === generationRef.current)
        setError(
          "We couldn’t scan this image. Check your connection for the OCR language download, try another photo, or add items manually.",
        );
    } finally {
      if (worker) await worker.terminate();
      if (generation === generationRef.current) {
        workerRef.current = null;
        setScanning(false);
      }
    }
  }

  function fileChanged(event: ChangeEvent<HTMLInputElement>) {
    void processFile(event.target.files?.[0]);
    event.target.value = "";
  }
  function dropped(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void processFile(event.dataTransfer.files[0]);
  }

  function addPerson() {
    if (!personName.trim() || bill.people.length >= 50) return;
    updateBill((previous) => ({
      ...previous,
      people: [
        ...previous.people,
        { id: crypto.randomUUID(), name: personName.trim().slice(0, 40) },
      ],
    }));
    setPersonName("");
  }

  async function calculateSplit() {
    if ((requireRestaurant && !restaurant) || splitting) return;
    setSplitting(true);
    setError("");
    const revision = revisionRef.current;
    try {
      const response = await fetch("/api/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bill, restaurantId: restaurant?.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (revision !== revisionRef.current) return;
      setSplit(data.split);
      goToStage(2);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn’t split this bill. Please try again.",
      );
    } finally {
      setSplitting(false);
    }
  }

  function summaryText() {
    if (!split) return "";
    return [
      `Hseb Please${restaurant?.name || restaurantName ? ` · ${restaurant?.name || restaurantName}` : ""}`,
      bill.title,
      "",
      ...split.people.map((p) => `${p.name}: ${money(p.total, bill.currency)}`),
      "",
      `Total: ${money(split.total, bill.currency)}`,
      "",
      "Good times. Fair splits.",
    ].join("\n");
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText());
      setNotice("Split copied. Send it to your people!");
    } catch {
      setError(
        "Clipboard access isn’t available. Download the summary instead.",
      );
    }
  }

  function downloadSummary() {
    const url = URL.createObjectURL(
      new Blob([summaryText()], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "hseb-please-split.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const currentAmount = (amount: number) =>
    (amount / 10 ** currencyDigits(bill.currency)).toFixed(
      currencyDigits(bill.currency),
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Hseb Please home">
          <span className="brand-symbol">
            <ReceiptText size={25} strokeWidth={1.7} />
          </span>
          <span>
            hseb
            <span className="brand-please">
              please<span className="brand-dot">.</span>
            </span>
          </span>
        </Link>
        <div className="sidebar-label">A LITTLE LESS MATH</div>
        <nav aria-label="Main navigation">
          <button className="nav-link active" onClick={() => goToStage(0)}>
            <ReceiptText size={19} /> Split a bill <span className="nav-dot" />
          </button>
          {requireRestaurant && (
            <button className="nav-link" onClick={() => setDirectoryOpen(true)}>
              <Store size={19} /> Restaurants{" "}
              <span className="tiny-tag">PARTNERS</span>
            </button>
          )}
          <button className="nav-link" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={19} /> How it works
          </button>
        </nav>
        <div className="sidebar-note">
          <div className="note-illustration">
            <Utensils size={24} />
            <Heart size={15} />
          </div>
          <h3>
            More company.
            <br />
            Less calculating.
          </h3>
          <p>
            The best part of a meal
            <br />
            is who you share it with.
          </p>
          <span className="arabic-note" lang="ar" dir="rtl">
            صحتين وعافية
          </span>
        </div>
        <div className="sidebar-bottom">
          <span className="small-logo">ح</span>
          <div>
            Made for your table.<span>With a little Lebanese soul.</span>
          </div>
          <Heart size={13} />
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Your table <span>/</span> <strong>Split a bill</strong>
          </div>
          <div className="topbar-right">
            <span className="free-badge">
              <span /> Always free for diners
            </span>
            <button
              className="icon-button help-button"
              onClick={() => setHelpOpen(true)}
              aria-label="How it works"
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> GOOD FOOD. GOOD COMPANY.
              </div>
              <h1>
                Good times. <span>Fair splits.</span>
              </h1>
              <p>Pass the plates, not the calculator. Let’s settle up.</p>
            </div>
            <div className="heading-stamp">
              <span lang="ar" dir="rtl">
                الحساب بليز
              </span>
              <span>the bill, please!</span>
              <Sparkles size={19} />
            </div>
          </div>

          <div className="workflow" aria-label="Bill progress">
            {["Your receipt", "Who had what?", "The fair split"].map(
              (label, index) => (
                <button
                  key={label}
                  className={`workflow-step ${stage === index ? "current" : ""} ${stage > index ? "complete" : ""}`}
                  disabled={
                    index === 1
                      ? !allowed || !bill.items.length || scanning
                      : index === 2
                        ? !split
                        : false
                  }
                  onClick={() => goToStage(index)}
                >
                  <span className="step-number">
                    {stage > index ? <Check size={14} /> : `0${index + 1}`}
                  </span>
                  <span>{label}</span>
                  {index !== 2 && <span className="step-line" />}
                </button>
              ),
            )}
          </div>

          {!requireRestaurant ? (
            <section className="restaurant-bar">
              <span className="restaurant-icon">
                <Store size={20} />
              </span>
              <div className="free-restaurant">
                <label className="overline" htmlFor="restaurant-name">
                  ANY RESTAURANT. EVERYONE WELCOME.
                </label>
                <input
                  id="restaurant-name"
                  placeholder="Where are we eating? (optional)"
                  maxLength={120}
                  value={restaurantName}
                  onChange={(e) => setRestaurantName(e.target.value)}
                />
              </div>
              <span className="verified">
                <Heart size={14} /> On the house
              </span>
            </section>
          ) : (
            <section
              className={`restaurant-bar ${restaurant && !allowed ? "restaurant-waiting" : ""}`}
              aria-label="Selected restaurant"
            >
              <span className="restaurant-icon">
                <Store size={20} />
              </span>
              <div>
                <span className="overline">
                  {restaurant ? "YOUR TABLE IS AT" : "FIRST, FIND YOUR TABLE"}
                </span>
                <strong>{restaurant?.name || "Where are we eating?"}</strong>
                {restaurant && (
                  <span className="restaurant-location">
                    <MapPin size={12} />{" "}
                    {restaurant.city || "Registered restaurant"}
                  </span>
                )}
              </div>
              <div className="restaurant-bar-action">
                {allowed && (
                  <span className="verified">
                    <ShieldCheck size={14} /> Partner restaurant
                  </span>
                )}
                <button
                  className="button button-small button-white"
                  onClick={() => setDirectoryOpen(true)}
                  disabled={scanning || splitting}
                >
                  {restaurant ? "Change" : "Choose restaurant"}
                  <ChevronDown size={14} />
                </button>
              </div>
            </section>
          )}
          {requireRestaurant && restaurant && !allowed && (
            <div className="message warning">
              <LockKeyhole size={18} />
              <span>
                This restaurant isn’t active yet. Please wait for the restaurant
                to register and activate Hseb Please before splitting.
              </span>
            </div>
          )}
          {error && (
            <div className="message error" role="alert">
              <CircleHelp size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <CheckCheck size={18} />
              <span>{notice}</span>
            </div>
          )}

          <div className="workspace-grid">
            <div className="workspace-main">
              {stage === 0 && (
                <section
                  id="receipt-section"
                  tabIndex={-1}
                  className="card receipt-card navigation-target"
                >
                  <div className="card-heading">
                    <div className="section-icon">
                      <ReceiptText size={20} />
                    </div>
                    <div>
                      <h2>Every good split starts with a receipt</h2>
                      <p>Snap it, upload it, and we’ll pick up the numbers.</p>
                    </div>
                    <span className="step-label">STEP 01</span>
                  </div>
                  <div
                    className={`dropzone ${dragging ? "dragging" : ""} ${scanning ? "scanning" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (allowed) setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={dropped}
                  >
                    <div className="receipt-art" aria-hidden="true">
                      <div className="art-orbit orbit-one" />
                      <div className="art-orbit orbit-two" />
                      <div className="mini-receipt">
                        <span className="mini-store">
                          <Utensils size={16} />
                        </span>
                        <span className="mini-line long" />
                        <span className="mini-line" />
                        <span className="mini-divider" />
                        <span className="mini-row">
                          <i />
                          <i />
                        </span>
                        <span className="mini-row">
                          <i />
                          <i />
                        </span>
                        <span className="mini-row">
                          <i />
                          <i />
                        </span>
                        <span className="mini-divider" />
                        <span className="mini-row total">
                          <i />
                          <i />
                        </span>
                      </div>
                      <span className="art-check">
                        <Check size={20} />
                      </span>
                      <Sparkles className="art-sparkle" size={23} />
                    </div>
                    <h3>
                      {scanning
                        ? `${scanLabel}… ${progress}%`
                        : "A photo is worth a thousand calculations."}
                    </h3>
                    <p>
                      {scanning
                        ? "Your image stays on this device. Just a moment."
                        : "Drop your receipt here, or choose an option below."}
                    </p>
                    {scanning ? (
                      <div className="scan-progress">
                        <div style={{ width: `${Math.max(progress, 4)}%` }} />
                      </div>
                    ) : (
                      <div className="upload-actions">
                        <button
                          className="button button-primary"
                          disabled={!allowed}
                          onClick={() => uploadRef.current?.click()}
                        >
                          <ImagePlus size={17} /> Upload receipt
                        </button>
                        <button
                          className="button button-white"
                          disabled={!allowed}
                          onClick={() => cameraRef.current?.click()}
                        >
                          <Camera size={17} /> Take a photo
                        </button>
                      </div>
                    )}
                    <span className="file-hint">
                      JPG, PNG, WebP or BMP · Up to 12 MB
                    </span>
                    {!allowed && (
                      <span className="upload-lock">
                        <LockKeyhole size={12} /> Choose an active partner
                        restaurant to get started
                      </span>
                    )}
                    <input
                      className="sr-only"
                      ref={uploadRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/bmp"
                      onChange={fileChanged}
                      aria-label="Upload receipt image"
                      disabled={!allowed || scanning}
                    />
                    <input
                      className="sr-only"
                      ref={cameraRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={fileChanged}
                      aria-label="Take receipt photo"
                      disabled={!allowed || scanning}
                    />
                  </div>
                  <div className="receipt-options">
                    <span>
                      <ShieldCheck size={15} /> Your receipt stays on your
                      device
                    </span>
                    <label>
                      Receipt language{" "}
                      <select
                        value={language}
                        disabled={scanning}
                        onChange={(e) => setLanguage(e.target.value)}
                      >
                        <option value="eng">English</option>
                        <option value="eng+ara">English + Arabic</option>
                      </select>
                    </label>
                  </div>
                  <div className="manual-divider">
                    <span /> OR KEEP IT SIMPLE <span />
                  </div>
                  <div className="manual-options">
                    <button disabled={!allowed || scanning} onClick={addItem}>
                      <FilePlus2 size={18} />
                      <span>Add items manually</span>
                      <ArrowRight size={15} />
                    </button>
                    <button
                      disabled={!allowed || scanning}
                      onClick={async () => {
                        if (
                          bill.items.length &&
                          !(await confirm({
                            title: "Take a sample for a spin?",
                            description:
                              "This will replace your current bill and people with an example table. Your existing draft will be replaced too.",
                            confirmLabel: "Load sample receipt",
                          }))
                        )
                          return;
                        setBill(demoBill());
                        setSplit(null);
                        setDetectedSubtotal(null);
                        setPreview("");
                        setRawText("");
                        setScanReview("");
                        setNotice(
                          "Sample receipt loaded. These are example items, not your restaurant’s menu.",
                        );
                        scrollTo("items-section");
                      }}
                    >
                      <Sparkles size={18} />
                      <span>Try a sample receipt</span>
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
              )}

              {stage === 1 && (
                <section
                  id="people-section"
                  tabIndex={-1}
                  className="card people-card navigation-target"
                >
                  <div className="card-heading">
                    <div className="section-icon">
                      <Users size={20} />
                    </div>
                    <div>
                      <h2>Who’s at the table?</h2>
                      <p>Add your people. Shared plates are always welcome.</p>
                    </div>
                    <span className="step-label">STEP 02</span>
                  </div>
                  <div className="people-list">
                    {bill.people.map((person, index) => (
                      <div className="person-pill" key={person.id}>
                        <Avatar name={person.name} index={index} small />
                        <input
                          aria-label={`Name for person ${index + 1}`}
                          maxLength={40}
                          value={person.name}
                          onChange={(e) =>
                            updateBill((b) => ({
                              ...b,
                              people: b.people.map((p) =>
                                p.id === person.id
                                  ? { ...p, name: e.target.value }
                                  : p,
                              ),
                            }))
                          }
                        />
                        <button
                          className="icon-button"
                          disabled={bill.people.length <= 1 || splitting}
                          aria-label={`Remove ${person.name}`}
                          onClick={() =>
                            updateBill((b) => ({
                              ...b,
                              people: b.people.filter(
                                (p) => p.id !== person.id,
                              ),
                              items: b.items.map((i) => ({
                                ...i,
                                personIds: i.personIds.filter(
                                  (id) => id !== person.id,
                                ),
                              })),
                            }))
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <form
                    className="add-person"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addPerson();
                    }}
                  >
                    <input
                      aria-label="New person’s name"
                      placeholder="A friend’s name…"
                      maxLength={40}
                      value={personName}
                      onChange={(e) => setPersonName(e.target.value)}
                    />
                    <button
                      className="button button-white button-small"
                      disabled={
                        !personName.trim() ||
                        bill.people.length >= 50 ||
                        splitting
                      }
                    >
                      <Plus size={16} /> Add person
                    </button>
                  </form>
                  <div className="split-mode">
                    <button
                      className={bill.mode === "items" ? "selected" : ""}
                      onClick={() =>
                        updateBill((b) => ({ ...b, mode: "items" }))
                      }
                    >
                      <Utensils size={15} /> By what we had
                    </button>
                    <button
                      className={bill.mode === "equal" ? "selected" : ""}
                      onClick={() =>
                        updateBill((b) => ({ ...b, mode: "equal" }))
                      }
                    >
                      <Users size={15} /> Split equally
                    </button>
                  </div>
                </section>
              )}

              {stage < 2 && bill.items.length > 0 && (
                <section
                  id="items-section"
                  tabIndex={-1}
                  className="card items-card navigation-target"
                >
                  <div className="card-heading">
                    <div>
                      <h2>
                        {stage === 0 ? "A quick double-check" : "Who had what?"}
                      </h2>
                      <p>
                        {stage === 0
                          ? "Edit any item. Amounts are line totals, including quantity."
                          : bill.mode === "equal"
                            ? "Everything is shared equally across the table."
                            : "Tap a name to assign an item. Tap several to share it."}
                      </p>
                    </div>
                    <span className="count-badge">
                      {bill.items.length} items
                    </span>
                  </div>
                  {preview && (
                    <details className="receipt-preview">
                      <summary>View original receipt</summary>
                      <Image
                        src={preview}
                        alt="Your uploaded receipt"
                        width={600}
                        height={800}
                        unoptimized
                        style={{
                          width: "auto",
                          height: "auto",
                          objectFit: "contain",
                        }}
                      />
                    </details>
                  )}
                  {detectedSubtotal !== null && detectedSubtotal !== total && (
                    <div className="message warning">
                      Receipt subtotal: {money(detectedSubtotal, bill.currency)}
                      . Your items add up to {money(total, bill.currency)}.
                      Check for missing items or discounts.
                    </div>
                  )}
                  {scanReview && (
                    <div className="message warning" role="status">
                      <CircleHelp size={16} />
                      <span>{scanReview}</span>
                    </div>
                  )}
                  <div className="item-table-head">
                    <span>ITEM</span>
                    <span>QTY</span>
                    <span>LINE TOTAL</span>
                    <span />
                  </div>
                  <fieldset
                    className="items-fieldset"
                    disabled={splitting || scanning || !allowed}
                  >
                    {bill.items.map((item, index) => (
                      <div
                        className="item-block navigation-target"
                        id={`bill-item-${item.id}`}
                        key={item.id}
                      >
                        <div className="item-row">
                          <label className="item-name">
                            <span className="item-index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <input
                              aria-label={`Item ${index + 1} name`}
                              dir="auto"
                              maxLength={120}
                              value={item.name}
                              onChange={(e) =>
                                updateBill((b) => ({
                                  ...b,
                                  items: b.items.map((i) =>
                                    i.id === item.id
                                      ? { ...i, name: e.target.value }
                                      : i,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label className="item-quantity">
                            <span className="mobile-field-label">Qty</span>
                            <input
                              className="quantity-input"
                              type="number"
                              inputMode="numeric"
                              min="1"
                              max="999"
                              aria-label={`Quantity for ${item.name}`}
                              value={item.quantity}
                              onChange={(e) =>
                                updateBill((b) => ({
                                  ...b,
                                  items: b.items.map((i) =>
                                    i.id === item.id
                                      ? {
                                          ...i,
                                          quantity: Math.max(
                                            1,
                                            Math.min(
                                              999,
                                              Math.floor(
                                                Number(e.target.value),
                                              ),
                                            ),
                                          ),
                                        }
                                      : i,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label className="item-amount">
                            <span className="mobile-field-label">
                              Line total
                            </span>
                            <input
                              className="amount-input"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step={bill.currency === "LBP" ? "1" : "0.01"}
                              aria-label={`Line total for ${item.name}`}
                              key={`${item.id}-${bill.currency}-${item.amount}`}
                              defaultValue={currentAmount(item.amount)}
                              onBlur={(e) =>
                                updateBill((b) =>
                                  updateLineTotal(b, item.id, e.target.value),
                                )
                              }
                            />
                          </label>
                          <button
                            className="icon-button delete-item"
                            aria-label={`Remove ${item.name}`}
                            onClick={() =>
                              updateBill((b) => ({
                                ...b,
                                items: b.items.filter((i) => i.id !== item.id),
                              }))
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        {stage === 1 && bill.mode === "items" && (
                          <div className="assignments">
                            {bill.people.map((person, pIndex) => (
                              <button
                                key={person.id}
                                className={`assign-chip ${item.personIds.includes(person.id) ? "assigned" : ""}`}
                                aria-pressed={item.personIds.includes(
                                  person.id,
                                )}
                                onClick={() =>
                                  updateBill((b) => ({
                                    ...b,
                                    items: b.items.map((i) =>
                                      i.id === item.id
                                        ? {
                                            ...i,
                                            personIds: i.personIds.includes(
                                              person.id,
                                            )
                                              ? i.personIds.filter(
                                                  (id) => id !== person.id,
                                                )
                                              : [...i.personIds, person.id],
                                          }
                                        : i,
                                    ),
                                  }))
                                }
                              >
                                <Avatar
                                  name={person.name}
                                  index={pIndex}
                                  small
                                />
                                {person.name || "Unnamed"}
                                {item.personIds.includes(person.id) && (
                                  <Check size={12} />
                                )}
                              </button>
                            ))}
                            <button
                              className="everyone-button"
                              onClick={() =>
                                updateBill((b) => ({
                                  ...b,
                                  items: b.items.map((i) =>
                                    i.id === item.id
                                      ? {
                                          ...i,
                                          personIds: b.people.map((p) => p.id),
                                        }
                                      : i,
                                  ),
                                }))
                              }
                            >
                              Everyone
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </fieldset>
                  <button
                    className="text-button add-item-button"
                    disabled={
                      !allowed ||
                      scanning ||
                      splitting ||
                      bill.items.length >= 500
                    }
                    onClick={addItem}
                  >
                    <Plus size={16} /> Add an item
                  </button>
                  {rawText && (
                    <details className="ocr-text">
                      <summary>Review scanned text</summary>
                      <textarea
                        aria-label="Scanned receipt text"
                        dir="auto"
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                      />
                      <button
                        className="button button-white button-small"
                        disabled={!allowed || scanning || splitting}
                        onClick={() => applyReceipt(rawText)}
                      >
                        Read edited text again
                      </button>
                    </details>
                  )}
                </section>
              )}

              {stage === 2 && split && (
                <section
                  id="split-section"
                  tabIndex={-1}
                  className="card results-card navigation-target"
                >
                  <div className="result-check">
                    <CheckCheck size={27} />
                  </div>
                  <div className="eyebrow">ALL SQUARE, ALL SMILES</div>
                  <h2>Here’s everyone’s share.</h2>
                  <p>A little less math. A little more good company.</p>
                  <div className="result-people">
                    {split.people.map((person, index) => (
                      <div className="result-person" key={person.id}>
                        <Avatar name={person.name} index={index} />
                        <div>
                          <strong>{person.name}</strong>
                          <span>
                            {bill.mode === "equal"
                              ? "Equal share of the items"
                              : "Their share of the items"}
                          </span>
                        </div>
                        <strong className="person-total">
                          {money(person.total, bill.currency)}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <div className="result-reconciled">
                    <Check size={15} /> Every{" "}
                    {bill.currency === "LBP" ? "lira" : "cent"} accounted for.
                    Total {money(split.total, bill.currency)}.
                  </div>
                  <div className="result-actions">
                    <button
                      className="button button-primary"
                      onClick={copySummary}
                    >
                      <Copy size={16} /> Copy the split
                    </button>
                    <button
                      className="button button-white"
                      onClick={downloadSummary}
                    >
                      <ArrowDownToLine size={16} /> Download
                    </button>
                  </div>
                  <button className="text-button" onClick={() => goToStage(1)}>
                    <ArrowLeft size={14} /> Back to the table
                  </button>
                </section>
              )}

              {stage === 0 && !bill.items.length && (
                <div className="tip-card">
                  <span className="tip-icon">
                    <Sparkles size={19} />
                  </span>
                  <div>
                    <strong>A little tip for a better scan</strong>
                    <p>
                      Lay your receipt flat, find good light, and get the whole
                      bill in the frame.
                    </p>
                  </div>
                  <span className="tip-doodle" aria-hidden="true">
                    ✧
                  </span>
                </div>
              )}
            </div>

            <aside className="summary-column">
              <section className="bill-summary">
                <div className="summary-top">
                  <div>
                    <span className="overline">THE TABLE’S TAB</span>
                    <h2>Your bill, at a glance</h2>
                  </div>
                  <ReceiptText size={24} strokeWidth={1.3} />
                </div>
                <div className="summary-body">
                  <label className="bill-title-label">
                    BILL NAME
                    <input
                      value={bill.title}
                      aria-label="Bill name"
                      maxLength={80}
                      disabled={splitting}
                      onChange={(e) =>
                        updateBill((b) => ({ ...b, title: e.target.value }))
                      }
                    />
                  </label>
                  <div className="summary-meta">
                    <span>
                      <Utensils size={14} /> {bill.items.length} items
                    </span>
                    <span>
                      <Users size={14} /> {bill.people.length}{" "}
                      {bill.people.length === 1 ? "person" : "people"}
                    </span>
                    <label className="currency-select">
                      <span className="sr-only">Currency</span>
                      <select
                        aria-label="Currency"
                        value={bill.currency}
                        disabled={scanning || splitting}
                        onChange={async (e) => {
                          const currency = e.target.value as Currency;
                          if (
                            bill.items.length > 0 &&
                            !(await confirm({
                              title: `Switch to ${currency}?`,
                              description: `Your amounts will keep their numeric values. This does not convert exchange rates.${currency === "LBP" ? " LBP amounts are rounded to whole lira." : ""}`,
                              confirmLabel: `Switch to ${currency}`,
                              cancelLabel: `Keep ${bill.currency}`,
                            }))
                          )
                            return;
                          const factor =
                            10 **
                            (currencyDigits(currency) -
                              currencyDigits(bill.currency));
                          updateBill((b) => ({
                            ...b,
                            currency,
                            items: b.items.map((i) => ({
                              ...i,
                              amount: Math.round(i.amount * factor),
                            })),
                          }));
                          setDetectedSubtotal(null);
                        }}
                      >
                        <option>USD</option>
                        <option>LBP</option>
                      </select>
                    </label>
                  </div>
                  <div className="summary-rule" />
                  <div className="grand-total">
                    <span>Total bill</span>
                    <strong>{money(total, bill.currency)}</strong>
                  </div>
                  <p className="summary-footnote">
                    Only the items on your bill are included in the split.
                  </p>
                  {stage === 0 ? (
                    <button
                      className="button button-primary continue-button"
                      disabled={!allowed || !bill.items.length || scanning}
                      onClick={() => goToStage(1)}
                    >
                      Add your people <ArrowRight size={17} />
                    </button>
                  ) : stage === 1 ? (
                    <button
                      className="button button-primary continue-button"
                      disabled={
                        !allowed ||
                        !bill.items.length ||
                        !!missing ||
                        splitting ||
                        bill.people.some((p) => !p.name.trim())
                      }
                      onClick={calculateSplit}
                    >
                      {splitting ? (
                        <>
                          <LoaderCircle className="spin" size={17} /> Checking
                          restaurant…
                        </>
                      ) : (
                        <>
                          Let’s split it <ArrowRight size={17} />
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      className="button button-primary continue-button"
                      onClick={newBill}
                    >
                      Start a fresh bill <Plus size={17} />
                    </button>
                  )}
                  <div className="summary-status">
                    {stage === 1 && missing ? (
                      <>
                        <CircleHelp size={12} /> Assign {missing} remaining{" "}
                        {missing === 1 ? "item" : "items"}
                      </>
                    ) : (
                      <>
                        <LockKeyhole size={12} />{" "}
                        {!requireRestaurant
                          ? "Free for everyone. At every table."
                          : allowed
                            ? "Free for you. Courtesy of your restaurant."
                            : "Available at registered restaurants"}
                      </>
                    )}
                  </div>
                </div>
                <div className="receipt-teeth" />
              </section>
              <div className="under-summary">
                <Leaf size={16} />
                <p>
                  No awkward math.
                  <br />
                  <strong>Just a fair share.</strong>
                </p>
              </div>
              {bill.items.length > 0 && stage < 2 && (
                <button
                  className="text-button reset-button"
                  disabled={scanning || splitting}
                  onClick={newBill}
                >
                  <RotateCcw size={13} /> Start over
                </button>
              )}
            </aside>
          </div>
          <footer className="page-footer">
            <span>
              <span className="footer-dot" />{" "}
              {saved
                ? "Draft saved on this device"
                : "Browser storage unavailable"}
            </span>
            <span>
              Made for meals worth sharing <Heart size={12} />
            </span>
          </footer>
        </main>
      </div>

      {directoryOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDirectoryOpen(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="directory-title"
          >
            <button
              className="modal-close icon-button"
              onClick={() => setDirectoryOpen(false)}
              aria-label="Close restaurant directory"
            >
              <X size={21} />
            </button>
            <span className="modal-icon">
              <Store size={25} />
            </span>
            <div className="eyebrow">FIND YOUR TABLE</div>
            <h2 id="directory-title">Good food has a home.</h2>
            <p>
              Choose the restaurant on your receipt. Your restaurant takes care
              of Hseb Please, so you don’t have to.
            </p>
            <label className="search-input">
              <Search size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your restaurant…"
                aria-label="Search restaurants"
              />
            </label>
            <div className="restaurant-results" aria-live="polite">
              {directoryLoading ? (
                <div className="directory-empty">
                  <LoaderCircle className="spin" size={22} />
                  <p>Finding your table…</p>
                </div>
              ) : directoryError ? (
                <div className="directory-empty">
                  <LockKeyhole size={25} />
                  <strong>We’re getting the tables ready.</strong>
                  <p>{directoryError}</p>
                </div>
              ) : restaurants.length ? (
                restaurants.map((r) => (
                  <button
                    className="restaurant-result"
                    key={r.id}
                    onClick={() => selectRestaurant(r)}
                  >
                    <span className="restaurant-icon">
                      <Store size={20} />
                    </span>
                    <span>
                      <strong>{r.name}</strong>
                      <span>{r.city || "Partner restaurant"}</span>
                    </span>
                    <span
                      className={`restaurant-status ${canSplit(r) ? "is-active" : ""}`}
                    >
                      {canSplit(r) ? "Ready to split" : "Coming soon"}
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))
              ) : (
                <div className="directory-empty">
                  <Store size={26} />
                  <strong>No table found just yet.</strong>
                  <p>
                    This restaurant needs to register before you can split its
                    bill. Please check back once it joins Hseb Please.
                  </p>
                </div>
              )}
            </div>
            <div className="directory-note">
              <ShieldCheck size={16} />
              <span>
                Only registered, active restaurants can offer bill splitting.
              </span>
            </div>
          </section>
        </div>
      )}
      {helpOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHelpOpen(false);
          }}
        >
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <button
              className="modal-close icon-button"
              onClick={() => setHelpOpen(false)}
              aria-label="Close help"
            >
              <X size={21} />
            </button>
            <span className="modal-icon">
              <ReceiptText size={26} />
            </span>
            <div className="eyebrow">A LITTLE LESS MATH</div>
            <h2 id="help-title">From “hseb, please” to all settled.</h2>
            <div className="help-steps">
              {[
                [
                  Store,
                  "Find your restaurant",
                  requireRestaurant
                    ? "Open its restaurant link or choose it from the directory. Splitting is available once the restaurant is registered and active."
                    : "You’re welcome at every table. Add your restaurant’s name if you like, or go straight to your receipt. It’s free for everyone.",
                ],
                [
                  Camera,
                  "Snap and double-check",
                  "Upload a receipt or use your camera. English and Arabic OCR runs on your device. Review the item names and amounts; scans can make mistakes.",
                ],
                [
                  Users,
                  "Gather your people",
                  "Add names and assign items to one or more people, or split everything equally. Line totals already include the item quantity.",
                ],
                [
                  FileCheck2,
                  "Share the fair split",
                  "We split your items fairly, accounting for rounding. Copy or download the result. No payments are collected in the app.",
                ],
              ].map(([Icon, title, description], i) => {
                const StepIcon = Icon as typeof Store;
                return (
                  <div key={i}>
                    <StepIcon size={22} />
                    <section>
                      <h3>{title as string}</h3>
                      <p>{description as string}</p>
                    </section>
                  </div>
                );
              })}
            </div>
            <div className="directory-note">
              <ShieldCheck size={17} />
              <span>
                No customer account needed. Drafts stay in this browser; receipt
                images aren’t saved after you leave.
              </span>
            </div>
          </section>
        </div>
      )}
      {confirmationDialog}
    </div>
  );
}
