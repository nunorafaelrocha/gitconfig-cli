#!/usr/bin/env zx

const isYes = input => {
  if (
    input.trim().toUpperCase() === "Y" ||
    input.trim().toUpperCase() === "YES"
  ) {
    return true;
  }

  return false;
};

const getNonEmptyAnswer = async text => {
  await sleep(500);
  const reply = (await question(text)).toString().trim();

  if (reply) {
    return reply;
  }

  console.log(`😡 whoops, empty answer, let's try again`);

  return await getNonEmptyAnswer(text);
};

const generateGPGkey = async ({ git_authorname, git_authoremail }) => {
  console.log("🤖 beep bop - generating new GPG key");

  await $`gpg --batch --gen-key <<EOF
Key-Type: 1
Key-Length: 4096
Subkey-Type: 1
Subkey-Length: 4096
Name-Real: ${git_authorname}
Name-Email: ${git_authoremail}
Expire-Date: 0
EOF`;

  // weird fix for the gpg-suite extra output.
  await $`gpg --list-secret-keys`;

  return (
    await $`gpg --list-secret-keys --keyid-format LONG | grep -B 2 ${git_authoremail} | grep 'sec' | tail -1 | cut -f 2 -d "/" | cut -f 1 -d " "`
  )
    .toString()
    .trim();
};

const updateLocalGitConfig = async ({
  git_authorname,
  git_authoremail,
  git_credential,
  gpg_key
}) => {
  const home = (await $`echo $HOME`).toString().trim();

  // Print New Config
  if (gpg_key) {
    console.log(`
      [user]
        name = ${git_authorname}
        email = ${git_authoremail}
        signingkey = ${gpg_key}
      [credential]
        helper = ${git_credential}
      [commit]
        gpgsign = ${gpg_key ? "true" : "false"}
    `);
  } else {
    console.log(`
      [user]
        name = ${git_authorname}
        email = ${git_authoremail}
      [credential]
        helper = ${git_credential}
      [commit]
        gpgsign = false
    `);
  }

  const confirmAndContinue = isYes(
    await getNonEmptyAnswer(
      `❓ Please confirm that you want to overwrite ${home}/.gitconfig.local [y/N] `
    )
  );

  if (!confirmAndContinue) {
    throw new error("Aborted");
  }

  const local_config = ".gitconfig.local";

  await $`git config --global --add include.path temp`;
  const included_paths = await $`git config --get-all include.path`;
  await $`git config --global --unset include.path temp`;

  const path_is_included = included_paths
    .toString()
    .trim()
    .split("\n")
    .includes(local_config);

  if (path_is_included == false) {
    await $`git config --global --add include.path ${local_config}`;
  }

  const local_config_fullpath = `${home}/${local_config}`;

  await $`git config -f ${local_config_fullpath} user.name "${git_authorname}"`;
  await $`git config -f ${local_config_fullpath} user.email ${git_authoremail}`;
  await $`git config -f ${local_config_fullpath} credential.helper "${git_credential}"`;

  if (gpg_key) {
    await $`git config -f ${local_config_fullpath} user.signingkey "${gpg_key}"`;
    await $`git config -f ${local_config_fullpath} commit.gpgsign true`;
  }

  console.log(`✅ ${home}/.gitconfig.local successfully updated`);

  if (gpg_key) {
    await $`gpg --armor --export "${gpg_key}" | pbcopy`;

    console.log(
      `ℹ️ Your public key was copied ✂️ to your clipboard - you can add 📋 it to GitHub in "SSH and GPG Keys" settings`
    );
  }
};

// In verbose mode, the zx prints all executed commands alongside with their outputs.
$.verbose = false;

// THE ACTUAL SCRIPT
const unix_name = (await $`uname`).toString().trim();
const git_credential = unix_name === "Darwin" ? "osxkeychain" : "cache";

const git_authorname = await getNonEmptyAnswer(
  "What is your name? "
);

const git_authoremail = await getNonEmptyAnswer(
  "What is the email you use on GitHub? "
);

const use_gpg_key = isYes(
  await getNonEmptyAnswer("Do want to sign your commits with a GPG Key? [y/N] ")
);

let gpg_key = null;
let generate_new_gpg_key = false;

if (use_gpg_key) {
  generate_new_gpg_key = isYes(
    await getNonEmptyAnswer("Do want to generate a new GPG Key? [y/N] ")
  );

  if (generate_new_gpg_key) {
    gpg_key = await generateGPGkey({ git_authorname, git_authoremail });
  } else {
    gpg_key = await getNonEmptyAnswer(
      "Please insert the signingkey that you want to use: "
    );
  }
}

try {
  await updateLocalGitConfig({
    git_authorname,
    git_authoremail,
    git_credential,
    gpg_key
  });
} catch (e) {
  // Clean up GPG key in case of error.
  if (gpg_key && generate_new_gpg_key) {
    const gpg_key_fingerprint = (
      await $`gpg --with-colons --fingerprint | grep ${gpg_key} | grep "^fpr" | cut -d: -f10`
    )
      .toString()
      .trim();

    await $`gpg --batch --delete-secret-keys ${gpg_key_fingerprint}`;
    await $`gpg --batch --delete-key ${gpg_key_fingerprint}`;

    console.log(`ℹ️ GPG key ${gpg_key} deleted`);
  }

  console.log(`🔥 Aborted`);
}
