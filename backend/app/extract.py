"""
Text extraction from an uploaded declaration document. No file is ever
written to disk or kept beyond this request -- this is a stateless,
session-only tool (see PRD Section 9).

Pages are joined with "[[page N]]" markers (same convention used elsewhere
in this portfolio's evidence-handling code) so a downstream quote can be
given a rough locator.

Degrade-loud: an unreadable file raises ValueError with a message the UI
shows verbatim, never a silent empty result. Scanned/image documents fall
back to OCR only if a local Tesseract install is actually detected
(config.ocr_configured()); otherwise the user is told to paste the text
manually rather than getting a thinner, unlabelled extraction.
"""
import io

from . import config

IMAGE_EXTENSIONS = ("png", "jpg", "jpeg")


def _ocr_image_bytes(content: bytes) -> str:
    import pytesseract
    from PIL import Image

    img = Image.open(io.BytesIO(content))
    return pytesseract.image_to_string(img)


def extract_text(filename: str, content: bytes) -> tuple[str, str | None]:
    """Returns (text_with_page_markers, warning). Raises ValueError if
    nothing usable could be read."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "txt":
        text = content.decode("utf-8", errors="replace")
        if not text.strip():
            raise ValueError("The uploaded text file is empty.")
        return f"[[page 1]]\n{text}", None

    if ext == "docx":
        import docx

        d = docx.Document(io.BytesIO(content))
        text = "\n".join(p.text for p in d.paragraphs if p.text.strip())
        if not text.strip():
            raise ValueError(
                "No text could be read from this Word document -- it appears to be empty."
            )
        return f"[[page 1]]\n{text}", None

    if ext == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        pages = [(page.extract_text() or "") for page in reader.pages]
        text = "\n".join(pages).strip()
        if text:
            marked = "\n\n".join(f"[[page {i + 1}]]\n{p}" for i, p in enumerate(pages))
            return marked, None

        # No text layer -- likely scanned. Try OCR only if actually available.
        if config.ocr_configured():
            try:
                from pdf2image import convert_from_bytes

                images = convert_from_bytes(content)
                ocr_pages = [_ocr_image_bytes(_pil_to_bytes(img)) for img in images]
                ocr_text = "\n\n".join(f"[[page {i + 1}]]\n{p}" for i, p in enumerate(ocr_pages))
                if ocr_text.strip():
                    return ocr_text, "Text was read via OCR from a scanned PDF -- check it carefully for errors."
            except Exception as e:
                raise ValueError(
                    f"This PDF has no text layer (it looks scanned) and OCR failed ({e.__class__.__name__}). "
                    "Paste the declaration text in manually instead."
                )

        raise ValueError(
            "This PDF has no text layer -- it looks like a scanned or photographed document, "
            "and OCR is not available on this installation. Paste the declaration text in manually instead."
        )

    if ext in IMAGE_EXTENSIONS:
        if not config.ocr_configured():
            raise ValueError(
                "This is an image file and OCR is not available on this installation. "
                "Paste the declaration text in manually instead."
            )
        try:
            text = _ocr_image_bytes(content)
        except Exception as e:
            raise ValueError(f"OCR failed on this image ({e.__class__.__name__}). Paste the text in manually instead.")
        if not text.strip():
            raise ValueError("OCR could not read any text from this image. Paste the text in manually instead.")
        return f"[[page 1]]\n{text}", "Text was read via OCR from an image -- check it carefully for errors."

    raise ValueError(
        f"Unsupported file type '.{ext}'. Upload a .pdf, .docx, .txt, or an image (.png/.jpg) of a scanned form."
    )


def _pil_to_bytes(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
