import type { PrizeRegistryEntry, RawAwardRecord, RawAwardRecordStatus } from "../../lib/award-records";

export type OfficialAwardRow = {
  categoryId: string;
  year: number;
  status: RawAwardRecordStatus;
  title: string;
  authors: string[];
  publisher?: string;
  sourceUrl: string;
  sourceLabel: string;
  notes?: string;
};

/**
 * Replaces complete category/year slots with rows checked against an official
 * award source. This keeps deterministic secondary-source importers useful for
 * the historical backfile without allowing a stale table to overwrite recent
 * official results.
 */
export function mergeOfficialAwardRows(
  records: RawAwardRecord[],
  prize: PrizeRegistryEntry,
  officialRows: OfficialAwardRow[],
): RawAwardRecord[] {
  if (!officialRows.length) return records;

  const categoriesById = new Map(prize.categories.map((category) => [category.id, category]));
  const replacedSlots = new Set(officialRows.map((row) => `${row.categoryId}:${row.year}`));
  const retainedRecords = records.filter((record) => !replacedSlots.has(`${record.categoryId}:${record.year}`));
  const replacements = officialRows.map((row): RawAwardRecord => {
    const category = categoriesById.get(row.categoryId);
    if (!category) throw new Error(`Unknown category ${row.categoryId} for ${prize.id}`);
    return {
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: row.year,
      status: row.status,
      title: row.title,
      authors: row.authors,
      publisher: row.publisher,
      sourceUrl: row.sourceUrl,
      sourceLabel: row.sourceLabel,
      sourceConfidence: "official",
      notes: row.notes,
    };
  });

  return [...retainedRecords, ...replacements];
}

const latimes2024Url = "https://events.latimes.com/festivalofbooks/bookprize/";
const latimes2025Url = "https://www.latimes.com/events/festival-of-books/book-prizes";

export const losAngelesTimesOfficialRows: OfficialAwardRow[] = [
  { categoryId: "latimes-biography", year: 2024, status: "winner", title: "Orwell's Ghosts: Wisdom and Warnings for the Twenty-First Century", authors: ["Laura Beers"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-biography", year: 2024, status: "finalist", title: "Candy Darling: Dreamer, Icon, Superstar", authors: ["Cynthia Carr"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-biography", year: 2024, status: "finalist", title: "We Were Illegal: Uncovering a Texas Family's Mythmaking and Migration", authors: ["Jessica Goudeau"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-biography", year: 2024, status: "finalist", title: "Survival Is a Promise: The Eternal Life of Audre Lorde", authors: ["Alexis Pauline Gumbs"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-biography", year: 2024, status: "finalist", title: "The Dragon from Chicago: The Untold Story of an American Reporter in Nazi Germany", authors: ["Pamela D. Toler"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },

  { categoryId: "latimes-current-interest", year: 2024, status: "winner", title: "The Rent Collectors: Exploitation, Murder, and Redemption in Immigrant LA", authors: ["Jesse Katz"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-current-interest", year: 2024, status: "finalist", title: "Everyone Who Is Gone Is Here: The United States, Central America, and the Making of a Crisis", authors: ["Jonathan Blitzer"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-current-interest", year: 2024, status: "finalist", title: "The Message", authors: ["Ta-Nehisi Coates"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-current-interest", year: 2024, status: "finalist", title: "The Serviceberry: Abundance and Reciprocity in the Natural World", authors: ["Robin Wall Kimmerer"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-current-interest", year: 2024, status: "finalist", title: "The Barn: The Secret History of a Murder in Mississippi", authors: ["Wright Thompson"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },

  { categoryId: "latimes-history", year: 2024, status: "winner", title: "Ruin Their Crops on the Ground: The Politics of Food in the United States, from the Trail of Tears to School Lunch", authors: ["Andrea Freeman"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-history", year: 2024, status: "finalist", title: "The Black Tax: 150 Years of Theft, Exploitation, and Dispossession in America", authors: ["Andrew W. Kahrl"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-history", year: 2024, status: "finalist", title: "The Black Utopians: Searching for Paradise and the Promised Land in America", authors: ["Aaron Robertson"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-history", year: 2024, status: "finalist", title: "Cold War Country: How Nashville's Music Row and the Pentagon Created the Sound of American Patriotism", authors: ["Joseph M. Thompson"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-history", year: 2024, status: "finalist", title: "The Other Olympians: Fascism, Queerness, and the Making of Modern Sports", authors: ["Michael Waters"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },

  { categoryId: "latimes-science-technology", year: 2024, status: "winner", title: "Our Moon: How Earth's Celestial Companion Transformed the Planet, Guided Evolution, and Made Us Who We Are", authors: ["Rebecca Boyle"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-science-technology", year: 2024, status: "finalist", title: "Becoming Earth: How Our Planet Came to Life", authors: ["Ferris Jabr"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-science-technology", year: 2024, status: "finalist", title: "Twelve Trees: The Deep Roots of Our Future", authors: ["Daniel Lewis"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-science-technology", year: 2024, status: "finalist", title: "Math in Drag", authors: ["Kyne Santos"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },
  { categoryId: "latimes-science-technology", year: 2024, status: "finalist", title: "The Light Eaters: How the Unseen World of Plant Intelligence Offers a New Understanding of Life on Earth", authors: ["Zoë Schlanger"], sourceUrl: latimes2024Url, sourceLabel: "Los Angeles Times: 2024 Book Prize winners and finalists" },

  { categoryId: "latimes-biography", year: 2025, status: "winner", title: "The Strangers: Five Extraordinary Black Men and the Worlds That Made Them", authors: ["Ekow Eshun"], publisher: "Harper", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-biography", year: 2025, status: "finalist", title: "Children of Radium: A Buried Inheritance", authors: ["Joe Dunthorne"], publisher: "Scribner", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-biography", year: 2025, status: "finalist", title: "The Many Lives of Anne Frank", authors: ["Ruth Franklin"], publisher: "Yale University Press", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-biography", year: 2025, status: "finalist", title: "Paper Girl: A Memoir of Home and Family in a Fractured America", authors: ["Beth Macy"], publisher: "Penguin Press", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-biography", year: 2025, status: "finalist", title: "Pride and Pleasure: The Schuyler Sisters in an Age of Revolution", authors: ["Amanda Vaill"], publisher: "Farrar, Straus and Giroux", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },

  { categoryId: "latimes-current-interest", year: 2025, status: "winner", title: "There Is No Place for Us: Working and Homeless in America", authors: ["Brian Goldstone"], publisher: "Crown", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-current-interest", year: 2025, status: "finalist", title: "A Greek Tragedy: One Day, a Deadly Shipwreck, and the Human Cost of the Refugee Crisis", authors: ["Jeanne Carstensen"], publisher: "One Signal Publishers", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-current-interest", year: 2025, status: "finalist", title: "Unabridged: The Thrill of (and Threat to) the Modern Dictionary", authors: ["Stefan Fatsis"], publisher: "Atlantic Monthly Press", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-current-interest", year: 2025, status: "finalist", title: "No More Tears: The Dark Secrets of Johnson & Johnson", authors: ["Gardiner Harris"], publisher: "Random House", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-current-interest", year: 2025, status: "finalist", title: "When It All Burns: Fighting Fire in a Transformed World", authors: ["Jordan Thomas"], publisher: "Riverhead Books", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },

  { categoryId: "latimes-history", year: 2025, status: "winner", title: "Born in Flames: The Business of Arson and the Remaking of the American City", authors: ["Bench Ansfield"], publisher: "W. W. Norton & Company", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-history", year: 2025, status: "finalist", title: "Black-Owned: The Revolutionary Life of the Black Bookstore", authors: ["Char Adams"], publisher: "Tiny Reparations Books", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-history", year: 2025, status: "finalist", title: "Titans of Industrial Agriculture: How a Few Giant Corporations Came to Dominate the Farm Sector and Why It Matters", authors: ["Jennifer Clapp"], publisher: "The MIT Press", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-history", year: 2025, status: "finalist", title: "Before Gender: Lost Stories from Trans History, 1850-1950", authors: ["Eli Erlick"], publisher: "Beacon Press", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-history", year: 2025, status: "finalist", title: "High School Students Unite!: Teen Activism, Education Reform, and FBI Surveillance in Postwar America", authors: ["Aaron G. Fountain Jr."], publisher: "University of North Carolina Press", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },

  { categoryId: "latimes-science-technology", year: 2025, status: "winner", title: "Empire of AI: Dreams and Nightmares in Sam Altman's OpenAI", authors: ["Karen Hao"], publisher: "Penguin Press", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-science-technology", year: 2025, status: "finalist", title: "They Poisoned the World: Life and Death in the Age of Forever Chemicals", authors: ["Mariah Blake"], publisher: "Crown", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-science-technology", year: 2025, status: "finalist", title: "The Story of CO2 Is the Story of Everything: How Carbon Dioxide Made Our World", authors: ["Peter Brannen"], publisher: "Ecco", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-science-technology", year: 2025, status: "finalist", title: "Strata: Stories from Deep Time", authors: ["Laura Poppick"], publisher: "W. W. Norton & Company", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
  { categoryId: "latimes-science-technology", year: 2025, status: "finalist", title: "When It All Burns: Fighting Fire in a Transformed World", authors: ["Jordan Thomas"], publisher: "Riverhead Books", sourceUrl: latimes2025Url, sourceLabel: "Los Angeles Times: 2025 Book Prize winners and finalists" },
];

const pen2024FinalistsUrl = "https://pen.org/2024-pen-america-literary-awards-finalists/";
const pen2025FinalistsUrl = "https://pen.org/announcing-the-2025-pen-america-literary-awards-finalists/";
const pen2025WinnersUrl = "https://pen.org/announcing-the-2025-pen-america-literary-awards-winners/";
const pen2026FinalistsUrl = "https://pen.org/2026-pen-america-literary-awards-finalists/";
const pen2026WinnersUrl = "https://pen.org/2026-literary-awards-winners/";

export const penDiamonsteinOfficialRows: OfficialAwardRow[] = [
  { categoryId: "pen-diamonstein-essay", year: 2024, status: "winner", title: "The Deadline: Essays", authors: ["Jill Lepore"], publisher: "Liveright", sourceUrl: pen2024FinalistsUrl, sourceLabel: "PEN America: 2024 Literary Awards finalists", notes: "Winner verified on the official award history page. Ross Gay's withdrawn title is intentionally omitted." },
  { categoryId: "pen-diamonstein-essay", year: 2024, status: "finalist", title: "Love and Industry: A Midwestern Workbook", authors: ["Sonya Huber"], publisher: "Belt Publishing", sourceUrl: pen2024FinalistsUrl, sourceLabel: "PEN America: 2024 Literary Awards finalists" },
  { categoryId: "pen-diamonstein-essay", year: 2024, status: "finalist", title: "Holding the Note: Profiles in Music", authors: ["David Remnick"], publisher: "Alfred A. Knopf", sourceUrl: pen2024FinalistsUrl, sourceLabel: "PEN America: 2024 Literary Awards finalists" },
  { categoryId: "pen-diamonstein-essay", year: 2024, status: "finalist", title: "Otherwise: Essays", authors: ["Julie Marie Wade"], publisher: "Autumn House Press", sourceUrl: pen2024FinalistsUrl, sourceLabel: "PEN America: 2024 Literary Awards finalists" },

  { categoryId: "pen-diamonstein-essay", year: 2025, status: "winner", title: "A Passing West", authors: ["Dagoberto Gilb"], publisher: "University of New Mexico Press", sourceUrl: pen2025WinnersUrl, sourceLabel: "PEN America: 2025 Literary Awards winners" },
  { categoryId: "pen-diamonstein-essay", year: 2025, status: "finalist", title: "Sing by the Burying Ground", authors: ["Marianne Boruch"], publisher: "Northwestern University Press", sourceUrl: pen2025FinalistsUrl, sourceLabel: "PEN America: 2025 Literary Awards finalists" },
  { categoryId: "pen-diamonstein-essay", year: 2025, status: "finalist", title: "The Salt of the Universe", authors: ["Amy Leach"], publisher: "Farrar, Straus and Giroux", sourceUrl: pen2025FinalistsUrl, sourceLabel: "PEN America: 2025 Literary Awards finalists" },
  { categoryId: "pen-diamonstein-essay", year: 2025, status: "finalist", title: "My Affair with Art House Cinema", authors: ["Phillip Lopate"], publisher: "Columbia University Press", sourceUrl: pen2025FinalistsUrl, sourceLabel: "PEN America: 2025 Literary Awards finalists" },
  { categoryId: "pen-diamonstein-essay", year: 2025, status: "finalist", title: "Magically Black and Other Essays", authors: ["Jerald Walker"], publisher: "Amistad", sourceUrl: pen2025FinalistsUrl, sourceLabel: "PEN America: 2025 Literary Awards finalists" },

  { categoryId: "pen-diamonstein-essay", year: 2026, status: "winner", title: "Putting Myself Together: Writing 1974–", authors: ["Jamaica Kincaid"], publisher: "Farrar, Straus and Giroux", sourceUrl: pen2026WinnersUrl, sourceLabel: "PEN America: 2026 Literary Awards winners" },
  { categoryId: "pen-diamonstein-essay", year: 2026, status: "finalist", title: "Culture Creep: Notes on the Pop Apocalypse", authors: ["Alice Bolin"], publisher: "HarperCollins", sourceUrl: pen2026FinalistsUrl, sourceLabel: "PEN America: 2026 Literary Awards finalists" },
  { categoryId: "pen-diamonstein-essay", year: 2026, status: "finalist", title: "The Haves and Have-Yachts: Dispatches on the Ultrarich", authors: ["Evan Osnos"], publisher: "Scribner", sourceUrl: pen2026FinalistsUrl, sourceLabel: "PEN America: 2026 Literary Awards finalists" },
  { categoryId: "pen-diamonstein-essay", year: 2026, status: "finalist", title: "Run the Song: Writing About Running About Listening", authors: ["Ben Ratliff"], publisher: "Graywolf Press", sourceUrl: pen2026FinalistsUrl, sourceLabel: "PEN America: 2026 Literary Awards finalists" },
  { categoryId: "pen-diamonstein-essay", year: 2026, status: "finalist", title: "Jazz June: A Self-Portrait in Essays", authors: ["Clifford Thompson"], publisher: "University of Georgia Press", sourceUrl: pen2026FinalistsUrl, sourceLabel: "PEN America: 2026 Literary Awards finalists" },
];

const gelber2026Url = "https://munkschool.utoronto.ca/lionel-gelber-prize";

export const lionelGelberOfficialRows: OfficialAwardRow[] = [
  { categoryId: "lionel-gelber", year: 2026, status: "winner", title: "Thinking Historically: A Guide to Statecraft and Strategy", authors: ["Francis J. Gavin"], publisher: "Yale University Press", sourceUrl: gelber2026Url, sourceLabel: "Munk School: 2026 Lionel Gelber Prize winner and shortlist" },
  { categoryId: "lionel-gelber", year: 2026, status: "shortlist", title: "King of Kings: The Iranian Revolution: A Story of Hubris, Delusion, and Catastrophic Miscalculation", authors: ["Scott Anderson"], publisher: "Signal / McClelland & Stewart", sourceUrl: gelber2026Url, sourceLabel: "Munk School: 2026 Lionel Gelber Prize winner and shortlist" },
  { categoryId: "lionel-gelber", year: 2026, status: "shortlist", title: "Capitalism: A Global History", authors: ["Sven Beckert"], publisher: "Penguin Press", sourceUrl: gelber2026Url, sourceLabel: "Munk School: 2026 Lionel Gelber Prize winner and shortlist" },
  { categoryId: "lionel-gelber", year: 2026, status: "shortlist", title: "House of Huawei: The Secret History of China's Most Powerful Company", authors: ["Eva Dou"], publisher: "Portfolio", sourceUrl: gelber2026Url, sourceLabel: "Munk School: 2026 Lionel Gelber Prize winner and shortlist" },
  { categoryId: "lionel-gelber", year: 2026, status: "shortlist", title: "How Progress Ends: Technology, Innovation and the Fate of Nations", authors: ["Carl Benedikt Frey"], publisher: "Princeton University Press", sourceUrl: gelber2026Url, sourceLabel: "Munk School: 2026 Lionel Gelber Prize winner and shortlist" },
];

const plutarchUrl = "https://biographersinternational.org/award/the-plutarch/";

export const plutarchOfficialRows: OfficialAwardRow[] = [
  { categoryId: "plutarch-biography", year: 2025, status: "finalist", title: "Reagan: His Life and Legend", authors: ["Max Boot"], publisher: "Liveright", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },
  { categoryId: "plutarch-biography", year: 2025, status: "co_winner", title: "Candy Darling: Dreamer, Icon, Superstar", authors: ["Cynthia Carr"], publisher: "Farrar, Straus and Giroux", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },
  { categoryId: "plutarch-biography", year: 2025, status: "finalist", title: "The Talented Mrs. Mandelbaum: The Rise and Fall of an American Organized-Crime Boss", authors: ["Margalit Fox"], publisher: "Random House", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },
  { categoryId: "plutarch-biography", year: 2025, status: "finalist", title: "The Icon & the Idealist: Margaret Sanger, Mary Ware Dennett, and the Rivalry That Brought Birth Control to America", authors: ["Stephanie Gorton"], publisher: "HarperCollins", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },
  { categoryId: "plutarch-biography", year: 2025, status: "finalist", title: "John Lewis: A Life", authors: ["David Greenberg"], publisher: "Simon & Schuster", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },
  { categoryId: "plutarch-biography", year: 2025, status: "finalist", title: "Survival Is a Promise: The Eternal Life of Audre Lorde", authors: ["Alexis Pauline Gumbs"], publisher: "Macmillan", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },
  { categoryId: "plutarch-biography", year: 2025, status: "co_winner", title: "The Scapegoat: The Brilliant Brief Life of the Duke of Buckingham", authors: ["Lucy Hughes-Hallett"], publisher: "Harper", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },
  { categoryId: "plutarch-biography", year: 2025, status: "finalist", title: "The Mysterious Mrs. Nixon: The Life and Times of Washington's Most Private First Lady", authors: ["Heath Hardage Lee"], publisher: "Macmillan", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },
  { categoryId: "plutarch-biography", year: 2025, status: "finalist", title: "The Rebel's Clinic: The Revolutionary Lives of Frantz Fanon", authors: ["Adam Shatz"], publisher: "Macmillan", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },
  { categoryId: "plutarch-biography", year: 2025, status: "finalist", title: "Monet: The Restless Vision", authors: ["Jackie Wullschläger"], publisher: "Penguin Random House", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: Plutarch Award finalists and winners" },

  { categoryId: "plutarch-biography", year: 2026, status: "finalist", title: "Baldwin: A Love Story", authors: ["Nicholas Boggs"], publisher: "Farrar, Straus and Giroux", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
  { categoryId: "plutarch-biography", year: 2026, status: "finalist", title: "The Einstein of Sex: Dr. Magnus Hirschfeld, Visionary of Weimar Berlin", authors: ["Daniel Brook"], publisher: "W. W. Norton & Company", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
  { categoryId: "plutarch-biography", year: 2026, status: "finalist", title: "Emerson's Daughters: Ellen Tucker Emerson, Edith Emerson Forbes, and Their Family Legacy", authors: ["Kate Culkin"], publisher: "University of Massachusetts Press", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
  { categoryId: "plutarch-biography", year: 2026, status: "finalist", title: "The Many Lives of Anne Frank", authors: ["Ruth Franklin"], publisher: "Yale University Press", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
  { categoryId: "plutarch-biography", year: 2026, status: "finalist", title: "The Second Emancipation: Nkrumah, Pan-Africanism, and Global Blackness at High Tide", authors: ["Howard W. French"], publisher: "Liveright", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
  { categoryId: "plutarch-biography", year: 2026, status: "finalist", title: "Wakara's America: The Life and Legacy of a Native Founder of the American West", authors: ["Max Perry Mueller"], publisher: "Basic Books", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
  { categoryId: "plutarch-biography", year: 2026, status: "finalist", title: "Wild Thing: A Life of Paul Gauguin", authors: ["Sue Prideaux"], publisher: "W. W. Norton & Company", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
  { categoryId: "plutarch-biography", year: 2026, status: "finalist", title: "Pride and Pleasure: The Schuyler Sisters in an Age of Revolution", authors: ["Amanda Vaill"], publisher: "Farrar, Straus and Giroux", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
  { categoryId: "plutarch-biography", year: 2026, status: "winner", title: "Gertrude Stein: An Afterlife", authors: ["Francesca Wade"], publisher: "Scribner", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
  { categoryId: "plutarch-biography", year: 2026, status: "finalist", title: "The Invention of Charlotte Brontë: A New Life", authors: ["Graham Watson"], publisher: "Pegasus Books", sourceUrl: plutarchUrl, sourceLabel: "Biographers International Organization: 2026 Plutarch Award finalists and winner" },
];

export const rachelCarsonOfficialRows: OfficialAwardRow[] = [
  {
    categoryId: "rachel-carson-environment-book",
    year: 2026,
    status: "winner",
    title: "Becoming Earth: A Journey Through the Hidden Wonders that Bring Our Planet to Life",
    authors: ["Ferris Jabr"],
    publisher: "Random House",
    sourceUrl: "https://www.sej2026.org/awards",
    sourceLabel: "Society of Environmental Journalists: 2026 award winners",
    notes: "First-place Rachel Carson Environment Book Award winner. SEJ did not publish a 2025 award cycle during its conference-calendar transition.",
  },
];

export const nyHistoryOfficialRows: OfficialAwardRow[] = [
  {
    categoryId: "ny-history-american-history",
    year: 2025,
    status: "winner",
    title: "A Place Called Yellowstone: The Epic History of the World's First National Park",
    authors: ["Randall K. Wilson"],
    sourceUrl: "https://shop.nyhistory.org/products/a-place-called-yellowstone",
    sourceLabel: "New York Historical: 2025 Barbara and David Zalaznick Book Prize winner",
  },
  {
    categoryId: "ny-history-american-history",
    year: 2026,
    status: "winner",
    title: "McNamara at War: A New History",
    authors: ["Philip Taubman", "William Taubman"],
    sourceUrl: "https://shop.nyhistory.org/products/mcnamara-at-war-a-new-history",
    sourceLabel: "New York Historical: 2026 Barbara and David Zalaznick Book Prize winner",
  },
];
